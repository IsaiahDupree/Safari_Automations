"""
Safari Automation Client

Python client for communicating with the Safari Automation service
via HTTP Control API (port 7070) and WebSocket Telemetry (port 7071).

Usage:
    from services.safari_automation_client import SafariAutomationClient
    
    client = SafariAutomationClient()
    
    # Check health
    if client.is_healthy():
        result = client.generate_clean_video("@isaiahdupree on Mars")
"""

import os
import json
import time
import logging
import threading
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass, field
from datetime import datetime

import requests

logger = logging.getLogger(__name__)


@dataclass
class CommandResult:
    """Result of a Safari Automation command."""
    success: bool
    command_id: str = ""
    status: str = ""
    result: Dict[str, Any] = field(default_factory=dict)
    error: str = ""


class SafariAutomationClient:
    """
    Client for Safari Automation Service.
    
    Communicates via:
    - HTTP REST on port 7070 (Control Plane)
    - WebSocket on port 7071 (Telemetry Plane)
    """
    
    DEFAULT_CONTROL_URL = "http://localhost:7070"
    DEFAULT_TELEMETRY_URL = "ws://localhost:7071"
    
    def __init__(
        self,
        control_url: Optional[str] = None,
        telemetry_url: Optional[str] = None,
        auth_token: Optional[str] = None,
        timeout: int = 30
    ):
        """
        Initialize the Safari Automation client.
        
        Args:
            control_url: HTTP control API URL (default: http://localhost:7070)
            telemetry_url: WebSocket telemetry URL (default: ws://localhost:7071)
            auth_token: Bearer token for authentication
            timeout: Request timeout in seconds
        """
        self.control_url = control_url or os.environ.get(
            "SAFARI_CONTROL_URL", self.DEFAULT_CONTROL_URL
        )
        self.telemetry_url = telemetry_url or os.environ.get(
            "SAFARI_TELEMETRY_URL", self.DEFAULT_TELEMETRY_URL
        )
        self.auth_token = auth_token or os.environ.get("SAFARI_AUTH_TOKEN")
        self.timeout = timeout
        
        self._session = requests.Session()
        if self.auth_token:
            self._session.headers["Authorization"] = f"Bearer {self.auth_token}"
        self._session.headers["Content-Type"] = "application/json"
    
    # =========================================================================
    # Health & Status
    # =========================================================================
    
    def health(self) -> Dict[str, Any]:
        """
        Check service health.
        
        Returns:
            Health status dict with 'status' and 'timestamp'
        """
        try:
            resp = self._session.get(
                f"{self.control_url}/health",
                timeout=self.timeout
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            logger.error(f"Health check failed: {e}")
            return {"status": "unhealthy", "error": str(e)}
    
    def is_healthy(self) -> bool:
        """Check if the service is healthy."""
        result = self.health()
        return result.get("status") == "healthy"
    
    def ready(self) -> Dict[str, Any]:
        """
        Check service readiness (all dependencies available).
        
        Returns:
            Readiness status with dependency checks
        """
        try:
            resp = self._session.get(
                f"{self.control_url}/ready",
                timeout=self.timeout
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            logger.error(f"Ready check failed: {e}")
            return {"ready": False, "error": str(e)}
    
    def is_ready(self) -> bool:
        """Check if the service is ready."""
        result = self.ready()
        return result.get("ready", False)
    
    def telemetry_stats(self) -> Dict[str, Any]:
        """
        Get telemetry server statistics.
        
        Returns:
            Stats including subscriber count, events stored, current cursor
        """
        try:
            resp = self._session.get(
                f"{self.control_url}/v1/telemetry/stats",
                timeout=self.timeout
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            logger.error(f"Telemetry stats failed: {e}")
            return {"error": str(e)}
    
    def status(self) -> Dict[str, Any]:
        """
        Get comprehensive service status.
        
        Returns:
            Combined health, readiness, and telemetry stats
        """
        return {
            "health": self.health(),
            "ready": self.ready(),
            "telemetry": self.telemetry_stats(),
            "checked_at": datetime.now().isoformat()
        }
    
    # =========================================================================
    # Commands
    # =========================================================================
    
    def submit_command(
        self,
        command_type: str,
        payload: Dict[str, Any],
        target: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None
    ) -> CommandResult:
        """
        Submit a command for execution.
        
        Args:
            command_type: Command type (e.g., 'sora.generate.clean')
            payload: Command payload
            target: Optional target (session_id, account_id, platform)
            idempotency_key: Optional key for deduplication
        
        Returns:
            CommandResult with command_id and initial status
        """
        body = {
            "type": command_type,
            "payload": payload
        }
        if target:
            body["target"] = target
        if idempotency_key:
            body["idempotency_key"] = idempotency_key
        
        try:
            resp = self._session.post(
                f"{self.control_url}/v1/commands",
                json=body,
                timeout=self.timeout
            )
            resp.raise_for_status()
            data = resp.json()
            return CommandResult(
                success=True,
                command_id=data.get("command_id", ""),
                status=data.get("status", "QUEUED")
            )
        except requests.RequestException as e:
            logger.error(f"Submit command failed: {e}")
            return CommandResult(success=False, error=str(e))
    
    def get_command(self, command_id: str) -> Dict[str, Any]:
        """
        Get command status and result.
        
        Args:
            command_id: The command ID
        
        Returns:
            Command state including status and result
        """
        try:
            resp = self._session.get(
                f"{self.control_url}/v1/commands/{command_id}",
                timeout=self.timeout
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            logger.error(f"Get command failed: {e}")
            return {"error": str(e)}
    
    def cancel_command(self, command_id: str) -> bool:
        """
        Cancel a running command.
        
        Args:
            command_id: The command ID
        
        Returns:
            True if cancelled successfully
        """
        try:
            resp = self._session.post(
                f"{self.control_url}/v1/commands/{command_id}/cancel",
                timeout=self.timeout
            )
            resp.raise_for_status()
            return True
        except requests.RequestException as e:
            logger.error(f"Cancel command failed: {e}")
            return False
    
    def list_commands(
        self,
        status: Optional[str] = None,
        since: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        List commands with optional filters.
        
        Args:
            status: Filter by status (QUEUED, RUNNING, SUCCEEDED, FAILED)
            since: Filter by date (ISO format)
        
        Returns:
            List of command states
        """
        params = {}
        if status:
            params["status"] = status
        if since:
            params["since"] = since
        
        try:
            resp = self._session.get(
                f"{self.control_url}/v1/commands",
                params=params,
                timeout=self.timeout
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("commands", [])
        except requests.RequestException as e:
            logger.error(f"List commands failed: {e}")
            return []
    
    def wait_for_command(
        self,
        command_id: str,
        poll_interval: float = 2.0,
        max_wait: float = 300.0
    ) -> Dict[str, Any]:
        """
        Wait for a command to complete.
        
        Args:
            command_id: The command ID
            poll_interval: Seconds between status checks
            max_wait: Maximum seconds to wait
        
        Returns:
            Final command state
        """
        start = time.time()
        while time.time() - start < max_wait:
            state = self.get_command(command_id)
            status = state.get("status", "")
            
            if status in ("SUCCEEDED", "FAILED", "CANCELLED"):
                return state
            
            time.sleep(poll_interval)
        
        return {"error": "Timeout waiting for command", "command_id": command_id}
    
    # =========================================================================
    # Sora Commands
    # =========================================================================
    
    def generate_video(
        self,
        prompt: str,
        character: Optional[str] = None,
        duration: str = "20s",
        aspect_ratio: str = "16:9",
        wait: bool = True
    ) -> Dict[str, Any]:
        """
        Generate a Sora video (with watermark).
        
        Args:
            prompt: Video prompt
            character: Character to use
            duration: Video duration
            aspect_ratio: Aspect ratio
            wait: Wait for completion
        
        Returns:
            Command result with video path
        """
        payload = {
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect_ratio
        }
        if character:
            payload["character"] = character
        
        result = self.submit_command("sora.generate", payload)
        if not result.success:
            return {"error": result.error}
        
        if wait:
            return self.wait_for_command(result.command_id)
        
        return {"command_id": result.command_id, "status": result.status}
    
    def generate_clean_video(
        self,
        prompt: str,
        character: Optional[str] = None,
        duration: str = "20s",
        aspect_ratio: str = "16:9",
        wait: bool = True
    ) -> Dict[str, Any]:
        """
        Generate a Sora video with automatic watermark removal.
        
        Args:
            prompt: Video prompt
            character: Character to use
            duration: Video duration
            aspect_ratio: Aspect ratio
            wait: Wait for completion
        
        Returns:
            Command result with cleaned video path
        """
        payload = {
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect_ratio
        }
        if character:
            payload["character"] = character
        
        result = self.submit_command("sora.generate.clean", payload)
        if not result.success:
            return {"error": result.error}
        
        if wait:
            return self.wait_for_command(result.command_id, max_wait=600)
        
        return {"command_id": result.command_id, "status": result.status}
    
    def clean_video(
        self,
        input_path: str,
        wait: bool = True
    ) -> Dict[str, Any]:
        """
        Remove watermark from an existing video.
        
        Args:
            input_path: Path to video with watermark
            wait: Wait for completion
        
        Returns:
            Command result with cleaned video path
        """
        payload = {"input_path": input_path}
        
        result = self.submit_command("sora.clean", payload)
        if not result.success:
            return {"error": result.error}
        
        if wait:
            return self.wait_for_command(result.command_id, max_wait=300)
        
        return {"command_id": result.command_id, "status": result.status}
    
    def batch_generate_clean(
        self,
        prompts: List[str],
        character: Optional[str] = None,
        wait: bool = True
    ) -> Dict[str, Any]:
        """
        Batch generate videos with watermark removal.
        
        Args:
            prompts: List of video prompts
            character: Character to use
            wait: Wait for completion
        
        Returns:
            Command result with all cleaned video paths
        """
        payload = {"prompts": prompts}
        if character:
            payload["character"] = character
        
        result = self.submit_command("sora.batch.clean", payload)
        if not result.success:
            return {"error": result.error}
        
        if wait:
            # Batch takes longer - 10 min per video max
            max_wait = len(prompts) * 600
            return self.wait_for_command(result.command_id, max_wait=max_wait)
        
        return {"command_id": result.command_id, "status": result.status}
    
    def get_sora_usage(self) -> Dict[str, Any]:
        """
        Get Sora usage statistics.
        
        Returns:
            Usage info including videos generated and limits
        """
        try:
            resp = self._session.get(
                f"{self.control_url}/v1/sora/usage",
                timeout=self.timeout
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            logger.error(f"Get Sora usage failed: {e}")
            return {"error": str(e)}
    
    # =========================================================================
    # Watermark-Free Video Queries
    # =========================================================================
    
    def list_clean_videos(
        self,
        since: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        List all watermark-free videos.
        
        Args:
            since: Filter by date (ISO format)
            limit: Maximum results
        
        Returns:
            List of cleaned video info
        """
        commands = self.list_commands(status="SUCCEEDED")
        
        clean_videos = []
        for cmd in commands:
            if cmd.get("type") in ("sora.generate.clean", "sora.clean", "sora.batch.clean"):
                result = cmd.get("result", {})
                if result.get("cleaned_path"):
                    clean_videos.append({
                        "command_id": cmd.get("command_id"),
                        "type": cmd.get("type"),
                        "cleaned_path": result.get("cleaned_path"),
                        "cleaned_size": result.get("cleaned_size"),
                        "original_path": result.get("video_path") or result.get("input_path"),
                        "completed_at": cmd.get("completed_at")
                    })
        
        # Filter by date if specified
        if since:
            clean_videos = [
                v for v in clean_videos
                if v.get("completed_at", "") >= since
            ]
        
        return clean_videos[:limit]
    
    def request_all_clean_videos(self) -> Dict[str, Any]:
        """
        Request status of all watermark-free video commands.
        
        Returns:
            Summary of all clean video commands
        """
        commands = self.list_commands()
        
        summary = {
            "total": 0,
            "succeeded": [],
            "running": [],
            "failed": [],
            "queued": []
        }
        
        for cmd in commands:
            cmd_type = cmd.get("type", "")
            if "clean" in cmd_type:
                summary["total"] += 1
                status = cmd.get("status", "")
                
                info = {
                    "command_id": cmd.get("command_id"),
                    "type": cmd_type,
                    "status": status,
                    "result": cmd.get("result", {})
                }
                
                if status == "SUCCEEDED":
                    summary["succeeded"].append(info)
                elif status == "RUNNING":
                    summary["running"].append(info)
                elif status == "FAILED":
                    summary["failed"].append(info)
                else:
                    summary["queued"].append(info)
        
        return summary


# =============================================================================
# Convenience Functions
# =============================================================================

_default_client: Optional[SafariAutomationClient] = None


def get_client() -> SafariAutomationClient:
    """Get or create the default client."""
    global _default_client
    if _default_client is None:
        _default_client = SafariAutomationClient()
    return _default_client


def check_service_health() -> bool:
    """Check if Safari Automation service is healthy."""
    return get_client().is_healthy()


def check_service_status() -> Dict[str, Any]:
    """Get comprehensive service status."""
    return get_client().status()


def generate_clean_video(prompt: str, **kwargs) -> Dict[str, Any]:
    """Generate a watermark-free Sora video."""
    return get_client().generate_clean_video(prompt, **kwargs)


def clean_existing_video(input_path: str) -> Dict[str, Any]:
    """Remove watermark from an existing video."""
    return get_client().clean_video(input_path)


def get_all_clean_videos() -> List[Dict[str, Any]]:
    """Get all watermark-free videos."""
    return get_client().list_clean_videos()


# =============================================================================
# CLI Testing
# =============================================================================

if __name__ == "__main__":
    import sys
    
    print("=" * 60)
    print("Safari Automation Client Test")
    print("=" * 60)
    
    client = SafariAutomationClient()
    
    # Check health
    print("\n[1] Health Check...")
    health = client.health()
    print(f"   Status: {health.get('status', 'unknown')}")
    
    if not client.is_healthy():
        print("\n❌ Service not healthy. Is Safari Automation running?")
        print("   Start with: cd 'Safari Automation/packages/protocol' && npm start")
        sys.exit(1)
    
    # Check readiness
    print("\n[2] Readiness Check...")
    ready = client.ready()
    print(f"   Ready: {ready.get('ready', False)}")
    print(f"   Checks: {ready.get('checks', {})}")
    
    # Get telemetry stats
    print("\n[3] Telemetry Stats...")
    stats = client.telemetry_stats()
    print(f"   Subscribers: {stats.get('subscribers', 0)}")
    print(f"   Events: {stats.get('events_stored', 0)}")
    
    # List commands
    print("\n[4] Listing Commands...")
    commands = client.list_commands()
    print(f"   Total commands: {len(commands)}")
    
    # List clean videos
    print("\n[5] Listing Watermark-Free Videos...")
    clean = client.list_clean_videos()
    print(f"   Clean videos: {len(clean)}")
    for v in clean[:5]:
        print(f"   - {v.get('cleaned_path', 'unknown')}")
    
    print("\n✅ Safari Automation Client Test Complete")
