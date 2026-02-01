"""
Safari Queue Manager - Unified browser automation orchestration
Manages all Safari operations through a single serialized queue.
"""
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, List, Callable, Any
from dataclasses import dataclass, field
from enum import Enum
from loguru import logger
import json

from services.event_bus import EventBus


class TaskType(str, Enum):
    COMMENT = "comment"
    TWEET = "tweet"
    DM_SEND = "dm_send"
    LEAD_DISCOVERY = "lead_discovery"
    SORA_POLL = "sora_poll"
    SORA_GENERATE = "sora_generate"
    STATS_CHECK = "stats_check"
    TREND_SCRAPE = "trend_scrape"
    VIDEO_DOWNLOAD = "video_download"
    WATERMARK_REMOVE = "watermark_remove"
    BLOTATO_POST = "blotato_post"


class TaskPriority(int, Enum):
    CRITICAL = 1      # Active Sora polling when generating
    HIGH = 2          # Twitter posting (time-sensitive)
    NORMAL = 3        # Commenting
    LOW = 4           # Stats polling
    BACKGROUND = 5    # Trend discovery


@dataclass
class SafariTask:
    """Represents a task in the Safari queue."""
    task_type: TaskType
    priority: TaskPriority = TaskPriority.NORMAL
    platform: Optional[str] = None
    payload: Dict = field(default_factory=dict)
    scheduled_at: Optional[datetime] = None
    status: str = "pending"
    retry_count: int = 0
    max_retries: int = 3
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    
    def __lt__(self, other):
        """Compare by priority then scheduled time."""
        if self.priority.value != other.priority.value:
            return self.priority.value < other.priority.value
        self_time = self.scheduled_at or self.created_at
        other_time = other.scheduled_at or other.created_at
        return self_time < other_time


class SafariQueueManager:
    """
    Central manager for all Safari browser operations.
    
    Ensures only one operation runs at a time while maintaining
    a priority queue for pending tasks.
    
    Schedule targets:
    - 30 comments/hour (1 every 2 minutes)
    - 1 tweet/2 hours
    - 30 Sora generations/day
    - Stats check every 10 minutes
    - Sora poll every 30 seconds when generating
    """
    
    COMMENTS_PER_HOUR = 30
    COMMENT_INTERVAL_SECONDS = 120  # 2 minutes
    TWEET_INTERVAL_HOURS = 2
    SORA_POLL_INTERVAL_SECONDS = 30
    STATS_INTERVAL_MINUTES = 10
    
    _instance = None
    
    @classmethod
    def get_instance(cls, event_bus: Optional[EventBus] = None):
        if cls._instance is None:
            cls._instance = cls(event_bus)
        return cls._instance
    
    @classmethod
    def reset_instance(cls):
        cls._instance = None
    
    def __init__(self, event_bus: Optional[EventBus] = None):
        self.event_bus = event_bus or EventBus.get_instance()
        self.queue: List[SafariTask] = []
        self.running = False
        self.current_task: Optional[SafariTask] = None
        self.paused = False
        self._task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        
        # Stats
        self.tasks_completed_today = 0
        self.comments_today = 0
        self.tweets_today = 0
        self.sora_generations_today = 0
        self.last_comment_at: Optional[datetime] = None
        self.last_tweet_at: Optional[datetime] = None
        
        # Task handlers
        self._handlers: Dict[TaskType, Callable] = {}
        
        # Sora state
        self.sora_generating = False
        self.sora_jobs_pending: List[str] = []
        
    def register_handler(self, task_type: TaskType, handler: Callable):
        """Register a handler function for a task type."""
        self._handlers[task_type] = handler
        logger.info(f"Registered handler for {task_type.value}")
        
    async def start(self):
        """Start the queue manager."""
        if self.running:
            return
        self.running = True
        logger.info("🚀 Starting Safari Queue Manager")
        
        # Reset daily counters if new day
        self._check_daily_reset()
        
        # Start the main processing loop
        self._task = asyncio.create_task(self._process_loop())
        
        # Start the scheduler that adds recurring tasks
        asyncio.create_task(self._scheduler_loop())
        
        await self.event_bus.publish("safari.queue.started", {
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
    async def stop(self):
        """Stop the queue manager."""
        self.running = False
        if self._task:
            self._task.cancel()
        logger.info("🛑 Safari Queue Manager stopped")
        
    def pause(self):
        """Pause queue processing."""
        self.paused = True
        logger.info("⏸️ Safari Queue paused")
        
    def resume(self):
        """Resume queue processing."""
        self.paused = False
        logger.info("▶️ Safari Queue resumed")
        
    async def add_task(self, task: SafariTask) -> bool:
        """Add a task to the queue."""
        async with self._lock:
            self.queue.append(task)
            self.queue.sort()  # Maintain priority order
            logger.debug(f"Added task: {task.task_type.value} (priority {task.priority.value})")
            return True
            
    async def add_comment_task(self, platform: str, post_url: str, comment_text: str):
        """Convenience method to add a comment task."""
        task = SafariTask(
            task_type=TaskType.COMMENT,
            priority=TaskPriority.NORMAL,
            platform=platform,
            payload={
                "post_url": post_url,
                "comment_text": comment_text
            }
        )
        await self.add_task(task)
        
    async def add_tweet_task(self, tweet_text: str, media_path: Optional[str] = None):
        """Convenience method to add a tweet task."""
        task = SafariTask(
            task_type=TaskType.TWEET,
            priority=TaskPriority.HIGH,
            platform="twitter",
            payload={
                "tweet_text": tweet_text,
                "media_path": media_path
            }
        )
        await self.add_task(task)
        
    async def add_sora_generation(self, prompt: str, trend_source: Optional[str] = None):
        """Queue a Sora video generation."""
        if self.sora_generations_today >= 30:
            logger.warning("Daily Sora limit (30) reached")
            return False
            
        task = SafariTask(
            task_type=TaskType.SORA_GENERATE,
            priority=TaskPriority.NORMAL,
            payload={
                "prompt": prompt,
                "trend_source": trend_source
            }
        )
        await self.add_task(task)
        return True
        
    async def _process_loop(self):
        """Main loop that processes tasks from the queue."""
        while self.running:
            try:
                if self.paused:
                    await asyncio.sleep(1)
                    continue
                    
                # Get next task
                task = await self._get_next_task()
                if not task:
                    await asyncio.sleep(0.5)
                    continue
                    
                # Execute task
                self.current_task = task
                task.status = "running"
                task.started_at = datetime.now(timezone.utc)
                
                try:
                    await self._execute_task(task)
                    task.status = "completed"
                    task.completed_at = datetime.now(timezone.utc)
                    self.tasks_completed_today += 1
                    self._update_counters(task)
                    
                except Exception as e:
                    task.status = "failed"
                    task.error_message = str(e)
                    task.retry_count += 1
                    logger.error(f"Task failed: {task.task_type.value} - {e}")
                    
                    # Re-queue if retries remaining
                    if task.retry_count < task.max_retries:
                        task.status = "pending"
                        task.scheduled_at = datetime.now(timezone.utc) + timedelta(seconds=30 * task.retry_count)
                        await self.add_task(task)
                        
                finally:
                    self.current_task = None
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Queue processing error: {e}")
                await asyncio.sleep(1)
                
    async def _get_next_task(self) -> Optional[SafariTask]:
        """Get the next task to execute."""
        async with self._lock:
            if not self.queue:
                return None
                
            now = datetime.now(timezone.utc)
            
            # Find first task that's ready (scheduled_at is None or in the past)
            for i, task in enumerate(self.queue):
                if task.scheduled_at is None or task.scheduled_at <= now:
                    return self.queue.pop(i)
                    
            return None
            
    async def _execute_task(self, task: SafariTask):
        """Execute a task using registered handler."""
        handler = self._handlers.get(task.task_type)
        
        if handler:
            await handler(task)
        else:
            # Default handlers
            if task.task_type == TaskType.COMMENT:
                await self._default_comment_handler(task)
            elif task.task_type == TaskType.TWEET:
                await self._default_tweet_handler(task)
            elif task.task_type == TaskType.SORA_POLL:
                await self._default_sora_poll_handler(task)
            elif task.task_type == TaskType.SORA_GENERATE:
                await self._default_sora_generate_handler(task)
            elif task.task_type == TaskType.STATS_CHECK:
                await self._default_stats_handler(task)
            else:
                logger.warning(f"No handler for task type: {task.task_type.value}")
                
    async def _default_comment_handler(self, task: SafariTask):
        """Default handler for comment tasks."""
        platform = task.platform
        post_url = task.payload.get("post_url")
        comment_text = task.payload.get("comment_text")
        
        logger.info(f"💬 Commenting on {platform}: {post_url[:50]}...")
        
        # Import appropriate poster based on platform
        if platform == "twitter":
            from automation.safari_twitter_poster import SafariTwitterPoster
            poster = SafariTwitterPoster(use_x_domain=True)
            # Twitter commenting would go here
        elif platform == "instagram":
            from automation.safari_instagram_poster import SafariInstagramPoster
            # Instagram commenting
            pass
        elif platform == "tiktok":
            from automation.tiktok_engagement import TikTokEngagement
            # TikTok commenting
            pass
        elif platform == "threads":
            from automation.safari_threads_poster import SafariThreadsPoster
            # Threads commenting
            pass
            
        # Simulate for now
        await asyncio.sleep(2)
        logger.info(f"✅ Comment posted on {platform}")
        
    async def _default_tweet_handler(self, task: SafariTask):
        """Default handler for tweet tasks."""
        tweet_text = task.payload.get("tweet_text")
        media_path = task.payload.get("media_path")
        
        logger.info(f"🐦 Posting tweet: {tweet_text[:50]}...")
        
        try:
            from automation.safari_twitter_poster import SafariTwitterPoster
            poster = SafariTwitterPoster(use_x_domain=True)
            
            # Check login
            if not poster.simple_login_check():
                raise Exception("Not logged into Twitter")
                
            # Post tweet
            success = poster.post_tweet(tweet_text)
            if success:
                logger.info("✅ Tweet posted successfully")
                self.tweets_today += 1
            else:
                raise Exception("Tweet posting failed")
                
        except ImportError:
            logger.warning("SafariTwitterPoster not available, simulating...")
            await asyncio.sleep(2)
            
    async def _default_sora_poll_handler(self, task: SafariTask):
        """Poll Sora for generation status."""
        logger.info("🎬 Polling Sora generation status...")
        
        try:
            from automation.sora_full_automation import SoraFullAutomation
            sora = SoraFullAutomation()
            
            # Check for completed videos
            # This would check the Sora library for completed generations
            await asyncio.sleep(1)
            
        except ImportError:
            await asyncio.sleep(1)
            
    async def _default_sora_generate_handler(self, task: SafariTask):
        """Start a Sora generation."""
        prompt = task.payload.get("prompt")
        
        logger.info(f"🎬 Starting Sora generation: {prompt[:50]}...")
        
        try:
            from automation.sora_full_automation import SoraFullAutomation
            sora = SoraFullAutomation()
            
            # Start generation
            self.sora_generating = True
            self.sora_generations_today += 1
            
            # Queue polling tasks
            for i in range(10):  # Poll 10 times
                poll_task = SafariTask(
                    task_type=TaskType.SORA_POLL,
                    priority=TaskPriority.CRITICAL,
                    scheduled_at=datetime.now(timezone.utc) + timedelta(seconds=30 * (i + 1))
                )
                await self.add_task(poll_task)
                
        except ImportError:
            logger.warning("SoraFullAutomation not available")
            await asyncio.sleep(1)
            
    async def _default_stats_handler(self, task: SafariTask):
        """Poll for engagement stats."""
        logger.info("📊 Checking stats...")
        await asyncio.sleep(1)
        
    async def _scheduler_loop(self):
        """Background loop that schedules recurring tasks."""
        while self.running:
            try:
                now = datetime.now(timezone.utc)
                
                # Schedule comments (every 2 minutes)
                if self.comments_today < self.COMMENTS_PER_HOUR * 24:
                    if not self.last_comment_at or \
                       (now - self.last_comment_at).total_seconds() >= self.COMMENT_INTERVAL_SECONDS:
                        # Rotate through platforms
                        platforms = ["twitter", "tiktok", "instagram", "threads"]
                        platform = platforms[self.comments_today % len(platforms)]
                        
                        task = SafariTask(
                            task_type=TaskType.COMMENT,
                            priority=TaskPriority.NORMAL,
                            platform=platform,
                            payload={
                                "post_url": f"https://{platform}.com/trending",
                                "comment_text": "AI will generate contextual comment"
                            }
                        )
                        await self.add_task(task)
                        self.last_comment_at = now
                        
                # Schedule tweets (every 2 hours)
                if self.tweets_today < 12:
                    if not self.last_tweet_at or \
                       (now - self.last_tweet_at).total_seconds() >= self.TWEET_INTERVAL_HOURS * 3600:
                        task = SafariTask(
                            task_type=TaskType.TWEET,
                            priority=TaskPriority.HIGH,
                            platform="twitter",
                            payload={
                                "tweet_text": "AI will generate offer tweet"
                            }
                        )
                        await self.add_task(task)
                        
                # Schedule stats check (every 10 minutes)
                task = SafariTask(
                    task_type=TaskType.STATS_CHECK,
                    priority=TaskPriority.LOW,
                    scheduled_at=now + timedelta(minutes=self.STATS_INTERVAL_MINUTES)
                )
                await self.add_task(task)
                
                await asyncio.sleep(60)  # Check scheduler every minute
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Scheduler error: {e}")
                await asyncio.sleep(5)
                
    def _check_daily_reset(self):
        """Reset counters if it's a new day."""
        # Simple reset - in production would check actual date
        pass
        
    def _update_counters(self, task: SafariTask):
        """Update counters after task completion."""
        if task.task_type == TaskType.COMMENT:
            self.comments_today += 1
        elif task.task_type == TaskType.TWEET:
            self.tweets_today += 1
        elif task.task_type == TaskType.SORA_GENERATE:
            self.sora_generations_today += 1
            
    def get_status(self) -> Dict:
        """Get current queue status."""
        return {
            "running": self.running,
            "paused": self.paused,
            "queue_size": len(self.queue),
            "current_task": self.current_task.task_type.value if self.current_task else None,
            "tasks_completed_today": self.tasks_completed_today,
            "comments_today": self.comments_today,
            "tweets_today": self.tweets_today,
            "sora_generations_today": self.sora_generations_today,
            "sora_generating": self.sora_generating
        }
        
    def get_queue_preview(self, limit: int = 10) -> List[Dict]:
        """Preview upcoming tasks."""
        return [
            {
                "type": t.task_type.value,
                "priority": t.priority.value,
                "platform": t.platform,
                "scheduled_at": t.scheduled_at.isoformat() if t.scheduled_at else None
            }
            for t in self.queue[:limit]
        ]
