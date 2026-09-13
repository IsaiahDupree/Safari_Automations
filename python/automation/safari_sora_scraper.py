#!/usr/bin/env python3
"""
Sora Video Scraper using Safari and AppleScript.
Scrapes videos from sora.chatgpt.com/profile using native macOS Safari automation.
Downloads videos and removes watermarks using FFmpeg.
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

STORAGE_BASE = "/Users/isaiahdupree/Documents/SoraVideos"


class SafariSoraScraper:
    """Safari-based Sora video scraper using AppleScript."""
    
    def __init__(self, max_videos: int = 500):
        self.max_videos = max_videos
        self.storage_path = Path(STORAGE_BASE)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self.manifest_path = self.storage_path / "sora_manifest.json"
        
        self.video_urls = []
        self.downloaded = []
        self.failed = []
        
        logger.info(f"Safari Sora scraper initialized, saving to {self.storage_path}")
    
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
    
    def press_down_arrow(self) -> None:
        """Press down arrow key to go to next video."""
        script = '''
        tell application "System Events"
            tell process "Safari"
                key code 125
            end tell
        end tell
        '''
        self.run_applescript(script)
        time.sleep(2)
    
    def press_escape(self) -> None:
        """Press escape key."""
        script = '''
        tell application "System Events"
            tell process "Safari"
                key code 53
            end tell
        end tell
        '''
        self.run_applescript(script)
        time.sleep(1)
    
    def get_scroll_height(self) -> int:
        """Get the current scroll height."""
        result = self.execute_javascript("document.body.scrollHeight")
        try:
            return int(result)
        except:
            return 0
    
    def check_if_logged_in(self) -> bool:
        """Check if user is logged into Sora/ChatGPT."""
        # Check for profile or user elements
        js_code = '''
        (document.querySelector('[data-testid="profile-button"]') ||
         document.querySelector('img[alt*="User"]') ||
         window.location.pathname.includes('/profile')) ? 'logged_in' : 'not_logged_in';
        '''
        result = self.execute_javascript(js_code)
        return result == "logged_in" or "profile" in self.get_current_url()
    
    def collect_video_urls_from_grid(self) -> List[str]:
        """Collect all video URLs from the profile grid page."""
        js_code = '''
        (function() {
            var links = document.querySelectorAll('a[href*="/p/s_"]');
            var urls = [];
            links.forEach(function(link) {
                var href = link.getAttribute('href');
                if (href && !urls.includes(href)) {
                    urls.push('https://sora.chatgpt.com' + href);
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
    
    def get_video_id_from_url(self, url: str) -> Optional[str]:
        """Extract video ID from Sora URL."""
        # https://sora.chatgpt.com/p/s_69577d54dac081919b462e49a30dafde
        match = re.search(r'/p/(s_[a-f0-9]+)', url)
        return match.group(1) if match else None
    
    def get_video_download_url(self) -> Optional[str]:
        """Get the video source URL from current video page."""
        js_code = '''
        (function() {
            var video = document.querySelector('video');
            if (video) {
                // Try to get the src directly
                if (video.src) return video.src;
                // Try source element
                var source = video.querySelector('source');
                if (source && source.src) return source.src;
                // Try currentSrc
                if (video.currentSrc) return video.currentSrc;
            }
            return '';
        })();
        '''
        result = self.execute_javascript(js_code)
        return result if result else None
    
    def load_manifest(self):
        """Load existing manifest."""
        if self.manifest_path.exists():
            with open(self.manifest_path) as f:
                data = json.load(f)
                self.video_urls = data.get('video_urls', [])
                self.downloaded = data.get('downloaded', [])
                self.failed = data.get('failed', [])
                logger.info(f"Loaded manifest: {len(self.video_urls)} URLs, {len(self.downloaded)} downloaded")
    
    def save_manifest(self):
        """Save current state."""
        with open(self.manifest_path, 'w') as f:
            json.dump({
                'video_urls': self.video_urls,
                'downloaded': self.downloaded,
                'failed': self.failed,
                'last_updated': datetime.now().isoformat()
            }, f, indent=2)
    
    def download_video(self, video_url: str, video_id: str) -> bool:
        """Download video from URL."""
        filepath = self.storage_path / f"{video_id}_watermarked.mp4"
        if filepath.exists():
            logger.info(f"Already downloaded: {video_id}")
            return True
        
        try:
            logger.info(f"Downloading {video_id}...")
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
                'Referer': 'https://sora.chatgpt.com/'
            }
            resp = requests.get(video_url, headers=headers, timeout=120, stream=True)
            if resp.status_code == 200:
                with open(filepath, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        f.write(chunk)
                logger.success(f"✓ Downloaded: {video_id}")
                return True
            else:
                logger.error(f"Download failed with status {resp.status_code}")
        except Exception as e:
            logger.error(f"Download error: {e}")
        return False
    
    def remove_watermark(self, video_id: str) -> bool:
        """Remove watermark by cropping bottom portion of video."""
        watermarked = self.storage_path / f"{video_id}_watermarked.mp4"
        clean = self.storage_path / f"{video_id}.mp4"
        
        if clean.exists():
            logger.info(f"Clean version already exists: {video_id}")
            return True
        
        if not watermarked.exists():
            logger.error(f"Watermarked file not found: {video_id}")
            return False
        
        try:
            # Get video dimensions
            probe_cmd = [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=p=0",
                str(watermarked)
            ]
            result = subprocess.run(probe_cmd, capture_output=True, text=True)
            width, height = map(int, result.stdout.strip().split(','))
            
            logger.info(f"Video dimensions: {width}x{height}")
            
            # Crop bottom 100px where Sora watermark is located
            # This removes "Sora @username" watermark completely
            crop_height = height - 100
            
            cmd = [
                "ffmpeg", "-y",
                "-i", str(watermarked),
                "-vf", f"crop={width}:{crop_height}:0:0",
                "-c:a", "copy",
                str(clean)
            ]
            
            logger.info(f"Removing watermark from {video_id}...")
            subprocess.run(cmd, capture_output=True, check=True)
            logger.success(f"✓ Watermark removed: {video_id}")
            return True
            
        except Exception as e:
            logger.error(f"Watermark removal failed: {e}")
            # Fallback: just copy the file
            try:
                import shutil
                shutil.copy(watermarked, clean)
                logger.warning(f"Copied original (watermark removal failed): {video_id}")
                return True
            except:
                return False
    
    async def collect_urls_from_profile(self):
        """Scroll through profile and collect all video URLs."""
        logger.info("Collecting video URLs from profile grid...")
        
        last_count = 0
        no_change_count = 0
        
        while len(self.video_urls) < self.max_videos and no_change_count < 5:
            # Collect URLs from current view
            new_urls = self.collect_video_urls_from_grid()
            for url in new_urls:
                if url not in self.video_urls:
                    self.video_urls.append(url)
            
            current_count = len(self.video_urls)
            logger.info(f"Collected {current_count} video URLs")
            
            if current_count == last_count:
                no_change_count += 1
            else:
                no_change_count = 0
            last_count = current_count
            
            # Scroll down
            self.scroll_page()
            self.save_manifest()
        
        logger.success(f"✓ Total URLs collected: {len(self.video_urls)}")
    
    async def collect_urls_by_navigation(self):
        """Navigate through videos using arrow keys to collect URLs."""
        logger.info("Navigating through videos to collect URLs...")
        
        # Click on first video to open viewer
        print("\n" + "="*60)
        print("MANUAL ACTION REQUIRED")
        print("="*60)
        print("\n👆 Please click on the FIRST video in the grid.")
        print("   This will open the video viewer.")
        print("\n   Press ENTER here when the video is open...")
        input()
        print("✓ Continuing...")
        time.sleep(2)
        
        last_url = ""
        no_change_count = 0
        
        while no_change_count < 3:
            current_url = self.get_current_url()
            
            if current_url and current_url != last_url and "/p/s_" in current_url:
                if current_url not in self.video_urls:
                    self.video_urls.append(current_url)
                    video_id = self.get_video_id_from_url(current_url)
                    logger.info(f"Collected: {video_id} ({len(self.video_urls)} total)")
                    
                    # Try to get download URL while we're here
                    download_url = self.get_video_download_url()
                    if download_url:
                        logger.info(f"Found download URL for {video_id}")
                
                no_change_count = 0
                last_url = current_url
            else:
                no_change_count += 1
            
            # Press down arrow to go to next video
            self.press_down_arrow()
            self.save_manifest()
        
        logger.success(f"✓ Total URLs collected: {len(self.video_urls)}")
    
    async def download_all_videos(self):
        """Download all collected videos."""
        logger.info(f"Downloading {len(self.video_urls)} videos...")
        
        for url in self.video_urls:
            video_id = self.get_video_id_from_url(url)
            if not video_id:
                continue
            
            if video_id in self.downloaded:
                continue
            
            # Navigate to video page
            self.navigate_to_url(url)
            time.sleep(3)
            
            # Get download URL
            download_url = self.get_video_download_url()
            
            if download_url:
                if self.download_video(download_url, video_id):
                    self.downloaded.append(video_id)
                    # Remove watermark
                    self.remove_watermark(video_id)
                else:
                    self.failed.append(video_id)
            else:
                logger.warning(f"Could not get download URL for {video_id}")
                self.failed.append(video_id)
            
            self.save_manifest()
        
        logger.success(f"✓ Downloaded: {len(self.downloaded)}, Failed: {len(self.failed)}")
    
    async def run(self, auto_download: bool = True):
        """Main run method - fully automatic, assumes logged in."""
        self.load_manifest()
        
        logger.info("Opening Safari...")
        self.open_safari()
        
        # Navigate to Sora profile
        logger.info("Navigating to Sora profile...")
        self.navigate_to_url("https://sora.chatgpt.com/profile")
        time.sleep(4)
        
        # Assume logged in - collect URLs by scrolling
        logger.info("Collecting video URLs (auto-scroll mode)...")
        await self.collect_urls_from_profile()
        
        # Auto download if enabled
        if auto_download and self.video_urls:
            logger.info(f"Auto-downloading {len(self.video_urls)} videos...")
            await self.download_all_videos()
        
        # Summary
        logger.info("="*60)
        logger.info("SUMMARY")
        logger.info("="*60)
        logger.success(f"✓ Videos collected: {len(self.video_urls)}")
        logger.success(f"✓ Downloaded: {len(self.downloaded)}")
        if self.failed:
            logger.warning(f"✗ Failed: {len(self.failed)}")
        logger.info(f"📁 Saved to: {self.storage_path}")
        logger.info(f"📄 Manifest: {self.manifest_path}")


async def main():
    scraper = SafariSoraScraper(max_videos=100)
    await scraper.run()


if __name__ == "__main__":
    asyncio.run(main())
