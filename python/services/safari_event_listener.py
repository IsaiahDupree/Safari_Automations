"""
Safari Automation Event Listener
================================
Connects to Safari Automation telemetry WebSocket (port 7071) and triggers
the video ready pipeline when videos are generated or cleaned.

Usage:
    # Start as background task
    from services.safari_event_listener import SafariEventListener
    
    listener = SafariEventListener()
    await listener.start()
    
    # Or run standalone
    python -m services.safari_event_listener
"""

import asyncio
import json
import os
from datetime import datetime
from typing import Dict, Any, Callable, Optional
from loguru import logger

try:
    import websockets
except ImportError:
    websockets = None
    logger.warning("websockets not installed - Safari event listener disabled")


class SafariEventListener:
    """
    Listens to Safari Automation telemetry WebSocket for video events.
    
    Events of interest:
    - sora.video.complete - Sora video generation finished
    - sora.video.downloaded - Video downloaded to local path
    - watermark.removal.complete - Watermark removed from video
    """
    
    def __init__(
        self,
        telemetry_url: str = None,
        auto_process: bool = True
    ):
        self.telemetry_url = telemetry_url or os.getenv(
            "SAFARI_TELEMETRY_URL", 
            "ws://localhost:7071"
        )
        self.auto_process = auto_process
        self._ws = None
        self._running = False
        self._handlers: Dict[str, Callable] = {}
        self._pipeline = None
        
        # Register default handlers
        self._register_default_handlers()
    
    def _register_default_handlers(self):
        """Register default event handlers"""
        self._handlers["sora.video.complete"] = self._handle_sora_complete
        self._handlers["sora.video.downloaded"] = self._handle_video_downloaded
        self._handlers["watermark.removal.complete"] = self._handle_watermark_complete
        self._handlers["command.completed"] = self._handle_command_completed
    
    @property
    def pipeline(self):
        """Lazy load the video ready pipeline"""
        if self._pipeline is None:
            from services.video_ready_pipeline import VideoReadyPipeline
            self._pipeline = VideoReadyPipeline()
        return self._pipeline
    
    def register_handler(self, event_type: str, handler: Callable):
        """Register a custom event handler"""
        self._handlers[event_type] = handler
    
    async def start(self):
        """Start listening for events"""
        if websockets is None:
            logger.error("Cannot start Safari event listener - websockets not installed")
            return
        
        self._running = True
        logger.info(f"🎧 Starting Safari event listener on {self.telemetry_url}")
        
        while self._running:
            try:
                async with websockets.connect(self.telemetry_url) as ws:
                    self._ws = ws
                    logger.success(f"✅ Connected to Safari Automation telemetry")
                    
                    # Subscribe to events
                    await ws.send(json.dumps({
                        "type": "subscribe",
                        "events": list(self._handlers.keys())
                    }))
                    
                    # Listen for events
                    async for message in ws:
                        await self._handle_message(message)
                        
            except websockets.exceptions.ConnectionClosed:
                logger.warning("WebSocket connection closed, reconnecting in 5s...")
                await asyncio.sleep(5)
            except Exception as e:
                logger.error(f"WebSocket error: {e}, reconnecting in 10s...")
                await asyncio.sleep(10)
    
    async def stop(self):
        """Stop listening"""
        self._running = False
        if self._ws:
            await self._ws.close()
    
    async def _handle_message(self, message: str):
        """Handle incoming WebSocket message"""
        try:
            data = json.loads(message)
            event_type = data.get("type") or data.get("event")
            
            if event_type in self._handlers:
                logger.info(f"📨 Received event: {event_type}")
                await self._handlers[event_type](data)
            else:
                logger.debug(f"Ignoring event: {event_type}")
                
        except json.JSONDecodeError:
            logger.warning(f"Invalid JSON message: {message[:100]}")
        except Exception as e:
            logger.error(f"Error handling message: {e}")
    
    async def _handle_sora_complete(self, data: Dict[str, Any]):
        """Handle Sora video generation complete"""
        logger.info("🎬 Sora video generation complete!")
        
        # Extract video info
        video_path = data.get("video_path") or data.get("output_path")
        prompt = data.get("prompt")
        character = data.get("character")
        
        if video_path and self.auto_process:
            result = await self.pipeline.process_video_ready(
                video_path=video_path,
                source="sora",
                publish_to=["youtube", "tiktok"],
                metadata={
                    "prompt": prompt,
                    "character": character,
                    "event": "sora.video.complete"
                }
            )
            logger.info(f"Pipeline result: {result.get('status')}")
    
    async def _handle_video_downloaded(self, data: Dict[str, Any]):
        """Handle video downloaded event"""
        video_path = data.get("video_path") or data.get("path")
        logger.info(f"📥 Video downloaded: {video_path}")
        
        if video_path and self.auto_process:
            result = await self.pipeline.process_video_ready(
                video_path=video_path,
                source="sora_download",
                publish_to=["youtube", "tiktok"],
                metadata=data
            )
            logger.info(f"Pipeline result: {result.get('status')}")
    
    async def _handle_watermark_complete(self, data: Dict[str, Any]):
        """Handle watermark removal complete"""
        video_path = data.get("output_path") or data.get("clean_path")
        original_path = data.get("input_path") or data.get("original_path")
        
        logger.info(f"✨ Watermark removed: {video_path}")
        
        if video_path and self.auto_process:
            result = await self.pipeline.process_video_ready(
                video_path=video_path,
                source="watermark_removal",
                publish_to=["youtube", "tiktok"],
                metadata={
                    "original_path": original_path,
                    "cleaned": True
                }
            )
            logger.info(f"Pipeline result: {result.get('status')}")
    
    async def _handle_command_completed(self, data: Dict[str, Any]):
        """Handle generic command completed event"""
        command = data.get("command", "")
        status = data.get("status", "")
        
        # Check if it's a video-related command
        if "sora" in command.lower() or "video" in command.lower():
            result = data.get("result", {})
            video_path = result.get("video_path") or result.get("output_path")
            
            if video_path and self.auto_process:
                logger.info(f"🎬 Video command completed: {command}")
                await self.pipeline.process_video_ready(
                    video_path=video_path,
                    source=command,
                    publish_to=["youtube", "tiktok"],
                    metadata=result
                )


# === Polling-based alternative (if WebSocket not available) ===

class SafariEventPoller:
    """
    Polls Safari Automation control API for completed jobs.
    
    Use this if WebSocket telemetry is not available.
    """
    
    def __init__(
        self,
        control_url: str = None,
        poll_interval: int = 10
    ):
        self.control_url = control_url or os.getenv(
            "SAFARI_CONTROL_URL",
            "http://localhost:7070"
        )
        self.poll_interval = poll_interval
        self._running = False
        self._seen_jobs = set()
        self._pipeline = None
    
    @property
    def pipeline(self):
        if self._pipeline is None:
            from services.video_ready_pipeline import VideoReadyPipeline
            self._pipeline = VideoReadyPipeline()
        return self._pipeline
    
    async def start(self):
        """Start polling for completed jobs"""
        import httpx
        
        self._running = True
        logger.info(f"🔄 Starting Safari event poller ({self.control_url})")
        
        async with httpx.AsyncClient() as client:
            while self._running:
                try:
                    # Get recent completed commands
                    response = await client.get(
                        f"{self.control_url}/v1/commands/recent",
                        params={"status": "completed", "limit": 10},
                        timeout=10
                    )
                    
                    if response.status_code == 200:
                        commands = response.json().get("commands", [])
                        
                        for cmd in commands:
                            cmd_id = cmd.get("command_id")
                            if cmd_id and cmd_id not in self._seen_jobs:
                                self._seen_jobs.add(cmd_id)
                                await self._process_completed_command(cmd)
                    
                except Exception as e:
                    logger.debug(f"Poll error: {e}")
                
                await asyncio.sleep(self.poll_interval)
    
    async def stop(self):
        self._running = False
    
    async def _process_completed_command(self, cmd: Dict[str, Any]):
        """Process a completed command"""
        command_type = cmd.get("command", "")
        result = cmd.get("result", {})
        
        # Check for video output
        video_path = (
            result.get("video_path") or 
            result.get("output_path") or
            result.get("clean_path")
        )
        
        if video_path:
            logger.info(f"🎬 Found completed video: {video_path}")
            await self.pipeline.process_video_ready(
                video_path=video_path,
                source=command_type,
                publish_to=["youtube", "tiktok"],
                metadata=result
            )


# === Main entry point ===

async def main():
    """Run the Safari event listener"""
    listener = SafariEventListener()
    
    try:
        await listener.start()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        await listener.stop()


if __name__ == "__main__":
    asyncio.run(main())
