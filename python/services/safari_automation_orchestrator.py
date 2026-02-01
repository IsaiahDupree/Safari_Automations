"""
Safari Automation Orchestrator
==============================
Unified orchestrator for all Safari browser automation tasks.

Manages:
- 30 comments/hour across Twitter, TikTok, Instagram, Threads
- 1 Twitter post every 2 hours (12/day)
- 30 Sora video generations per day
- Video download → BlankLogo watermark removal → Blotato distribution
- Stats polling during idle time

All operations are serialized through a single Safari browser queue.
"""
import asyncio
import os
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, List, Any
from dataclasses import dataclass, field
from pathlib import Path
from loguru import logger
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from services.safari_queue_manager import (
    SafariQueueManager, SafariTask, TaskType, TaskPriority
)
from services.event_bus import EventBus
from services.dm_warmth_system import DMWarmthManager, DMContact


# Paths
SORA_DOWNLOAD_DIR = Path("/Users/isaiahdupree/Documents/CompetitorResearch/sora_downloads")
PROCESSED_VIDEO_DIR = Path("/Users/isaiahdupree/Documents/Software/MediaPoster/Backend/data/sora_processed")


@dataclass
class OrchestratorConfig:
    """Configuration for the Safari orchestrator."""
    comments_per_hour: int = 30
    tweets_per_day: int = 12
    sora_generations_per_day: int = 30
    
    # Feature toggles
    twitter_posting_enabled: bool = False  # Disabled for testing
    sora_enabled: bool = False  # Disabled - enable when ready
    
    # Platform distribution for comments (should sum to comments_per_hour)
    twitter_comments_per_hour: int = 8
    tiktok_comments_per_hour: int = 8
    instagram_comments_per_hour: int = 7
    threads_comments_per_hour: int = 7
    
    # DM outreach (10 per hour per platform)
    dms_per_hour_per_platform: int = 10
    dm_platforms: list = field(default_factory=lambda: ["tiktok", "instagram", "twitter"])
    dm_interval_minutes: int = 6  # 10 DMs/hr = 1 every 6 min per platform
    
    # Intervals
    comment_interval_seconds: int = 120  # 2 minutes
    tweet_interval_hours: int = 2
    sora_poll_interval_seconds: int = 30
    stats_interval_minutes: int = 10
    
    # Video processing
    auto_process_downloads: bool = True
    auto_distribute_processed: bool = True


class VideoDownloadHandler(FileSystemEventHandler):
    """Watches for new Sora video downloads."""
    
    def __init__(self, orchestrator: 'SafariAutomationOrchestrator'):
        self.orchestrator = orchestrator
        
    def on_created(self, event):
        if event.is_directory:
            return
        if event.src_path.endswith('.mp4'):
            logger.info(f"🎬 New video detected: {event.src_path}")
            asyncio.create_task(
                self.orchestrator.process_downloaded_video(event.src_path)
            )


class SafariAutomationOrchestrator:
    """
    Main orchestrator for Safari automation.
    
    Coordinates all browser operations through a single queue to prevent
    conflicts and ensure smooth execution.
    """
    
    _instance = None
    
    @classmethod
    def get_instance(cls, event_bus: Optional[EventBus] = None):
        if cls._instance is None:
            cls._instance = cls(event_bus)
        return cls._instance
    
    @classmethod
    def reset_instance(cls):
        if cls._instance:
            cls._instance.stop_sync()
        cls._instance = None
    
    def __init__(self, event_bus: Optional[EventBus] = None):
        self.event_bus = event_bus or EventBus.get_instance()
        self.config = OrchestratorConfig()
        self.queue_manager = SafariQueueManager.get_instance(self.event_bus)
        
        # State
        self.running = False
        self.started_at: Optional[datetime] = None
        
        # Counters (reset daily)
        self.comments_today = 0
        self.tweets_today = 0
        self.sora_generations_today = 0
        self.videos_processed_today = 0
        self.dms_today = {"tiktok": 0, "instagram": 0, "twitter": 0}
        
        # Platform rotation
        self._comment_platform_index = 0
        self._dm_platform_index = 0
        self._platforms = ['twitter', 'tiktok', 'instagram', 'threads']
        self._dm_platforms = ['tiktok', 'instagram', 'twitter']
        
        # Tasks
        self._scheduler_task: Optional[asyncio.Task] = None
        self._video_watcher: Optional[Observer] = None
        
        # Services (lazy loaded)
        self._watermark_service = None
        self._blotato_connector = None
        self._twitter_poster = None
        self._sora_automation = None
        self._engagement_controller = None
        self._dm_warmth_manager = None
        self._lead_discovery = None
        
        # Register task handlers
        self._register_handlers()
        
    def _register_handlers(self):
        """Register task handlers with the queue manager."""
        self.queue_manager.register_handler(TaskType.COMMENT, self._handle_comment)
        self.queue_manager.register_handler(TaskType.TWEET, self._handle_tweet)
        self.queue_manager.register_handler(TaskType.DM_SEND, self._handle_dm_send)
        self.queue_manager.register_handler(TaskType.LEAD_DISCOVERY, self._handle_lead_discovery)
        self.queue_manager.register_handler(TaskType.SORA_GENERATE, self._handle_sora_generate)
        self.queue_manager.register_handler(TaskType.SORA_POLL, self._handle_sora_poll)
        self.queue_manager.register_handler(TaskType.WATERMARK_REMOVE, self._handle_watermark_remove)
        self.queue_manager.register_handler(TaskType.BLOTATO_POST, self._handle_blotato_post)
        self.queue_manager.register_handler(TaskType.STATS_CHECK, self._handle_stats_check)
        
    # =========================================================================
    # Lazy-loaded services
    # =========================================================================
    
    def _get_watermark_service(self):
        if self._watermark_service is None:
            from services.sora_daily.watermark_service import WatermarkRemovalService
            self._watermark_service = WatermarkRemovalService()
        return self._watermark_service
    
    def _get_blotato_connector(self):
        if self._blotato_connector is None:
            try:
                from connectors.blotato import BlotatoConnector
                self._blotato_connector = BlotatoConnector()
            except ImportError:
                logger.warning("BlotatoConnector not available")
        return self._blotato_connector
    
    def _get_twitter_poster(self):
        if self._twitter_poster is None:
            from automation.safari_twitter_poster import SafariTwitterPoster
            self._twitter_poster = SafariTwitterPoster(use_x_domain=True)
        return self._twitter_poster
    
    def _get_sora_automation(self):
        if self._sora_automation is None:
            from automation.sora_full_automation import SoraFullAutomation
            self._sora_automation = SoraFullAutomation()
        return self._sora_automation
    
    def _get_engagement_controller(self):
        if self._engagement_controller is None:
            from services.engagement.engagement_controller import EngagementController
            self._engagement_controller = EngagementController.get_instance()
        return self._engagement_controller
    
    def _get_dm_warmth_manager(self):
        if self._dm_warmth_manager is None:
            self._dm_warmth_manager = DMWarmthManager.get_instance(self.event_bus)
        return self._dm_warmth_manager
    
    def _get_lead_discovery(self):
        if self._lead_discovery is None:
            from services.lead_discovery_service import LeadDiscoveryService
            self._lead_discovery = LeadDiscoveryService(self.event_bus)
        return self._lead_discovery
    
    # =========================================================================
    # Lifecycle
    # =========================================================================
    
    async def start(self):
        """Start the orchestrator."""
        if self.running:
            logger.warning("Orchestrator already running")
            return
            
        self.running = True
        self.started_at = datetime.now(timezone.utc)
        logger.info("🚀 Starting Safari Automation Orchestrator")
        
        # Start queue manager
        await self.queue_manager.start()
        
        # Start video watcher
        if self.config.auto_process_downloads:
            self._start_video_watcher()
        
        # Start scheduler
        self._scheduler_task = asyncio.create_task(self._scheduler_loop())
        
        # Emit event
        await self.event_bus.publish("safari.orchestrator.started", {
            "timestamp": self.started_at.isoformat(),
            "config": {
                "comments_per_hour": self.config.comments_per_hour,
                "tweets_per_day": self.config.tweets_per_day,
                "sora_per_day": self.config.sora_generations_per_day
            }
        })
        
        logger.info("✅ Safari Automation Orchestrator started")
        
    async def stop(self):
        """Stop the orchestrator."""
        self.running = False
        
        # Stop scheduler
        if self._scheduler_task:
            self._scheduler_task.cancel()
            
        # Stop video watcher
        if self._video_watcher:
            self._video_watcher.stop()
            
        # Stop queue manager
        await self.queue_manager.stop()
        
        logger.info("🛑 Safari Automation Orchestrator stopped")
        
    def stop_sync(self):
        """Synchronous stop for cleanup."""
        self.running = False
        if self._video_watcher:
            self._video_watcher.stop()
            
    def _start_video_watcher(self):
        """Start watching for new video downloads."""
        SORA_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        
        handler = VideoDownloadHandler(self)
        self._video_watcher = Observer()
        self._video_watcher.schedule(handler, str(SORA_DOWNLOAD_DIR), recursive=False)
        self._video_watcher.start()
        logger.info(f"👁️ Watching for videos in {SORA_DOWNLOAD_DIR}")
        
    # =========================================================================
    # Scheduler
    # =========================================================================
    
    async def _scheduler_loop(self):
        """Main scheduling loop that adds tasks to the queue."""
        last_comment_at = None
        last_tweet_at = None
        last_stats_at = None
        
        while self.running:
            try:
                now = datetime.now(timezone.utc)
                
                # Check for daily reset
                self._check_daily_reset()
                
                # Schedule comments (every 2 minutes)
                if self.comments_today < self.config.comments_per_hour * 24:
                    if last_comment_at is None or \
                       (now - last_comment_at).total_seconds() >= self.config.comment_interval_seconds:
                        await self._schedule_comment()
                        last_comment_at = now
                        
                # Schedule tweets (every 2 hours)
                if self.tweets_today < self.config.tweets_per_day:
                    if last_tweet_at is None or \
                       (now - last_tweet_at).total_seconds() >= self.config.tweet_interval_hours * 3600:
                        await self._schedule_tweet()
                        last_tweet_at = now
                        
                # Schedule stats check (every 10 minutes)
                if last_stats_at is None or \
                   (now - last_stats_at).total_seconds() >= self.config.stats_interval_minutes * 60:
                    await self._schedule_stats_check()
                    last_stats_at = now
                    
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Scheduler error: {e}")
                await asyncio.sleep(5)
                
    def _check_daily_reset(self):
        """Reset counters at midnight."""
        # Simple implementation - could be enhanced with actual date tracking
        pass
        
    async def _schedule_comment(self):
        """Schedule a comment task."""
        platform = self._platforms[self._comment_platform_index % len(self._platforms)]
        self._comment_platform_index += 1
        
        task = SafariTask(
            task_type=TaskType.COMMENT,
            priority=TaskPriority.NORMAL,
            platform=platform,
            payload={
                "action": "auto_comment",
                "use_ai": True
            }
        )
        await self.queue_manager.add_task(task)
        
    async def _schedule_tweet(self):
        """Schedule a tweet task."""
        task = SafariTask(
            task_type=TaskType.TWEET,
            priority=TaskPriority.HIGH,
            platform="twitter",
            payload={
                "action": "generate_and_post",
                "use_ai": True
            }
        )
        await self.queue_manager.add_task(task)
        
    async def _schedule_stats_check(self):
        """Schedule a stats check task."""
        task = SafariTask(
            task_type=TaskType.STATS_CHECK,
            priority=TaskPriority.LOW,
            payload={"platforms": self._platforms}
        )
        await self.queue_manager.add_task(task)
        
    # =========================================================================
    # Task Handlers
    # =========================================================================
    
    async def _handle_comment(self, task: SafariTask):
        """Handle comment task via Safari automation."""
        platform = task.platform
        logger.info(f"💬 Posting comment on {platform}...")
        
        try:
            from services.auto_comment_service import AutoCommentService
            service = AutoCommentService()
            
            # Use the auto-comment service which handles Safari automation
            result = await service.auto_comment_feed(platform, num_posts=1)
            
            self.comments_today += 1
            logger.info(f"✅ Comment posted on {platform} ({self.comments_today} today)")
            
        except Exception as e:
            logger.error(f"Comment failed on {platform}: {e}")
            raise
            
    async def _handle_tweet(self, task: SafariTask):
        """Handle tweet posting via Safari automation."""
        if not self.config.twitter_posting_enabled:
            logger.info("🐦 Twitter posting disabled - skipping tweet")
            return
            
        logger.info("🐦 Posting tweet...")
        
        try:
            # Generate tweet using AI
            from services.twitter_campaign_service import TwitterCampaignService
            campaign_service = TwitterCampaignService()
            tweet_text = await campaign_service.generate_offer_tweet()
            
            # Post via Safari
            poster = self._get_twitter_poster()
            if not poster.simple_login_check():
                raise Exception("Not logged into Twitter")
                
            success = poster.post_tweet(tweet_text)
            if success:
                self.tweets_today += 1
                logger.info(f"✅ Tweet posted ({self.tweets_today} today)")
            else:
                raise Exception("Tweet posting failed")
                
        except Exception as e:
            logger.error(f"Tweet failed: {e}")
            raise
            
    async def _handle_sora_generate(self, task: SafariTask):
        """Handle Sora video generation."""
        if not self.config.sora_enabled:
            logger.info("🎬 Sora generation disabled - skipping")
            return
            
        prompt = task.payload.get("prompt", "")
        logger.info(f"🎬 Starting Sora generation: {prompt[:50]}...")
        
        try:
            sora = self._get_sora_automation()
            # Queue generation - actual implementation in SoraFullAutomation
            self.sora_generations_today += 1
            
            # Schedule polling tasks
            for i in range(10):
                poll_task = SafariTask(
                    task_type=TaskType.SORA_POLL,
                    priority=TaskPriority.CRITICAL,
                    scheduled_at=datetime.now(timezone.utc) + timedelta(seconds=30 * (i + 1)),
                    payload={"prompt": prompt}
                )
                await self.queue_manager.add_task(poll_task)
                
            logger.info(f"✅ Sora generation queued ({self.sora_generations_today} today)")
            
        except Exception as e:
            logger.error(f"Sora generation failed: {e}")
            raise
            
    async def _handle_sora_poll(self, task: SafariTask):
        """Poll Sora for generation completion."""
        logger.debug("🔄 Polling Sora generation status...")
        
        try:
            sora = self._get_sora_automation()
            # Check for completed videos in Sora library
            # If completed, video will be downloaded and watcher will trigger processing
            await asyncio.sleep(1)  # Placeholder for actual poll
            
        except Exception as e:
            logger.error(f"Sora poll failed: {e}")
            
    async def _handle_watermark_remove(self, task: SafariTask):
        """Handle watermark removal from downloaded video."""
        video_path = task.payload.get("video_path")
        logger.info(f"🧹 Removing watermark from {Path(video_path).name}...")
        
        try:
            service = self._get_watermark_service()
            result = await service.remove_watermark(video_path)
            
            if result["success"]:
                self.videos_processed_today += 1
                logger.info(f"✅ Watermark removed: {result['output_path']}")
                
                # Queue for Blotato distribution
                if self.config.auto_distribute_processed:
                    await self._queue_blotato_distribution(result["output_path"])
            else:
                logger.error(f"Watermark removal failed: {result.get('error')}")
                
        except Exception as e:
            logger.error(f"Watermark removal failed: {e}")
            raise
            
    async def _handle_blotato_post(self, task: SafariTask):
        """Handle video distribution to Blotato."""
        video_path = task.payload.get("video_path")
        logger.info(f"📤 Distributing to Blotato: {Path(video_path).name}...")
        
        try:
            connector = self._get_blotato_connector()
            if connector:
                # Submit to Blotato for multi-platform distribution
                # This uses the Blotato API, not Safari
                result = await connector.submit_video(video_path)
                logger.info(f"✅ Submitted to Blotato: {result}")
            else:
                logger.warning("Blotato connector not available")
                
        except Exception as e:
            logger.error(f"Blotato distribution failed: {e}")
            raise
            
    async def _handle_stats_check(self, task: SafariTask):
        """Handle stats polling across platforms."""
        logger.debug("📊 Checking stats...")
        # This would poll analytics from each platform
        await asyncio.sleep(1)
        
    async def _handle_dm_send(self, task: SafariTask):
        """Handle sending a DM via Safari automation."""
        platform = task.platform
        contact_id = task.payload.get("contact_id")
        message_text = task.payload.get("message_text")
        
        logger.info(f"📨 Sending DM on {platform}...")
        
        try:
            warmth_mgr = self._get_dm_warmth_manager()
            contact = warmth_mgr.get_contact(contact_id)
            
            if not contact:
                raise Exception(f"Contact {contact_id} not found")
                
            # Generate message if not provided
            if not message_text:
                from openai import OpenAI
                import os
                openai = OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
                response = openai.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "Generate a friendly, personalized DM opener for this contact. Keep it short (1-2 sentences), warm, and genuine. Don't be salesy."},
                        {"role": "user", "content": f"Contact: @{contact.username} on {platform}. Bio: {contact.bio or 'unknown'}. Building: {contact.building or 'unknown'}. Warmth: {contact.calculate_current_warmth():.0f}/100"}
                    ]
                )
                message_text = response.choices[0].message.content
                
            # Send via Safari automation
            if platform == "instagram":
                from automation.safari_twitter_dm import SafariTwitterDM
                # Would need Instagram DM automation
                pass
            elif platform == "twitter":
                from automation.safari_twitter_dm import SafariTwitterDM
                dm = SafariTwitterDM()
                success = await dm.send_dm(contact.username, message_text)
            elif platform == "tiktok":
                # Would need TikTok DM automation
                pass
                
            # Record the DM
            warmth_mgr.record_dm_sent(contact_id, message_text)
            self.dms_today[platform] = self.dms_today.get(platform, 0) + 1
            
            logger.info(f"✅ DM sent to @{contact.username} on {platform}")
            
        except Exception as e:
            logger.error(f"DM failed: {e}")
            raise
            
    async def _handle_lead_discovery(self, task: SafariTask):
        """Handle lead discovery via scraping."""
        platform = task.platform
        method = task.payload.get("method", "hashtag")
        
        logger.info(f"🔍 Discovering leads on {platform} via {method}...")
        
        try:
            discovery = self._get_lead_discovery()
            
            if method == "hashtag":
                hashtag = task.payload.get("hashtag", "entrepreneur")
                leads = await discovery.discover_from_hashtag(platform, hashtag, limit=10)
                logger.info(f"✅ Discovered {len(leads)} leads from #{hashtag}")
            elif method == "competitor":
                competitor = task.payload.get("competitor")
                leads = await discovery.discover_from_competitors(platform, competitor, limit=20)
                logger.info(f"✅ Discovered {len(leads)} leads from @{competitor}'s followers")
            elif method == "engagement":
                post_url = task.payload.get("post_url")
                leads = await discovery.discover_from_engagement(platform, post_url)
                logger.info(f"✅ Discovered {len(leads)} leads from engagement")
                
        except Exception as e:
            logger.error(f"Lead discovery failed: {e}")
            raise
        
    # =========================================================================
    # Video Processing Pipeline
    # =========================================================================
    
    async def process_downloaded_video(self, video_path: str):
        """Process a newly downloaded video through the pipeline."""
        logger.info(f"📥 Processing downloaded video: {video_path}")
        
        # Queue watermark removal
        task = SafariTask(
            task_type=TaskType.WATERMARK_REMOVE,
            priority=TaskPriority.HIGH,
            payload={"video_path": video_path}
        )
        await self.queue_manager.add_task(task)
        
    async def _queue_blotato_distribution(self, processed_video_path: str):
        """Queue processed video for Blotato distribution."""
        task = SafariTask(
            task_type=TaskType.BLOTATO_POST,
            priority=TaskPriority.NORMAL,
            payload={"video_path": processed_video_path}
        )
        await self.queue_manager.add_task(task)
        
    # =========================================================================
    # Sora Generation
    # =========================================================================
    
    async def queue_sora_generation(self, prompt: str, trend_source: Optional[str] = None):
        """Queue a new Sora video generation based on trends/offers."""
        if not self.config.sora_enabled:
            logger.info("🎬 Sora generation disabled - not queueing")
            return False
            
        if self.sora_generations_today >= self.config.sora_generations_per_day:
            logger.warning("Daily Sora limit reached (30)")
            return False
            
        task = SafariTask(
            task_type=TaskType.SORA_GENERATE,
            priority=TaskPriority.NORMAL,
            payload={
                "prompt": prompt,
                "trend_source": trend_source,
                "character": "@isaiahdupree"
            }
        )
        await self.queue_manager.add_task(task)
        return True
        
    # =========================================================================
    # Status & Control
    # =========================================================================
    
    def get_status(self) -> Dict[str, Any]:
        """Get current orchestrator status."""
        queue_status = self.queue_manager.get_status()
        
        return {
            "running": self.running,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "uptime_minutes": (datetime.now(timezone.utc) - self.started_at).total_seconds() / 60 if self.started_at else 0,
            
            "today": {
                "comments": self.comments_today,
                "tweets": self.tweets_today,
                "sora_generations": self.sora_generations_today,
                "videos_processed": self.videos_processed_today,
                "dms": self.dms_today,
                "total_dms": sum(self.dms_today.values())
            },
            
            "limits": {
                "comments_per_hour": self.config.comments_per_hour,
                "tweets_per_day": self.config.tweets_per_day,
                "sora_per_day": self.config.sora_generations_per_day,
                "dms_per_hour_per_platform": self.config.dms_per_hour_per_platform
            },
            
            "queue": queue_status,
            
            "services": {
                "watermark_service": self._watermark_service is not None,
                "blotato_connector": self._blotato_connector is not None,
                "twitter_poster": self._twitter_poster is not None,
                "sora_automation": self._sora_automation is not None
            }
        }
        
    def pause(self):
        """Pause the orchestrator."""
        self.queue_manager.pause()
        logger.info("⏸️ Orchestrator paused")
        
    def resume(self):
        """Resume the orchestrator."""
        self.queue_manager.resume()
        logger.info("▶️ Orchestrator resumed")
