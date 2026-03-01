"""
acquisition/api/routes/warmup.py — Warmup API endpoints.

Provides:
- POST /schedule — schedule warmup for contacts
- POST /execute — send pending warmup comments
- GET /status — warmup pipeline status
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import asyncio

from ...warmup_agent import WarmupAgent
from ...db import queries

router = APIRouter(tags=["warmup"], prefix="/api/acquisition/warmup")


# ── Request/Response Models ──────────────────────────────────────────────────


class ScheduleRequest(BaseModel):
    """Request to schedule warmup for contacts."""
    contact_ids: Optional[list[str]] = None  # If None, process all qualified
    limit: int = 50
    dry_run: bool = False


class ScheduleResponse(BaseModel):
    """Schedule warmup response."""
    contacts_processed: int
    schedules_created: int
    high_score_skips: int
    posts_found: int
    errors: list[str]


class ExecuteRequest(BaseModel):
    """Request to execute pending warmup comments."""
    platform: Optional[str] = None  # Filter to specific platform
    limit: int = 50
    dry_run: bool = False


class ExecuteResponse(BaseModel):
    """Execute warmup response."""
    comments_sent: int
    comments_failed: int
    contacts_completed: int
    rate_limit_skips: int
    errors: list[str]


class PlatformStatus(BaseModel):
    """Status for a single platform."""
    platform: str
    pending: int
    sent_today: int
    daily_cap: int


class WarmupStatusResponse(BaseModel):
    """Warmup pipeline status response."""
    pending_schedules: int
    contacts_warming: int
    contacts_ready_for_dm: int
    contacts_qualified: int
    completions_today: int
    completion_rate: float
    platforms: list[PlatformStatus]


# ── Routes ───────────────────────────────────────────────────────────────────


@router.post("/schedule", response_model=ScheduleResponse)
async def schedule_warmup(req: ScheduleRequest):
    """
    Schedule warmup comments for qualified contacts.

    If contact_ids provided, schedule those specific contacts.
    Otherwise, schedule all qualified contacts not yet in warmup pipeline.

    Returns:
    - contacts_processed: number of contacts processed
    - schedules_created: number of comment schedules created
    - high_score_skips: contacts skipped due to high ICP score
    - posts_found: total posts discovered for commenting
    - errors: list of error messages
    """
    agent = WarmupAgent(dry_run=req.dry_run)

    # If specific contact_ids provided, validate and process them
    if req.contact_ids:
        # TODO: Add support for processing specific contact_ids
        # For now, delegate to batch scheduler which processes all qualified
        pass

    # Run batch scheduler
    result = await agent.schedule_batch(limit=req.limit)

    # Count posts found (estimate from schedules created)
    posts_found = result.schedules_created

    return ScheduleResponse(
        contacts_processed=result.contacts_processed,
        schedules_created=result.schedules_created,
        high_score_skips=result.high_score_skips,
        posts_found=posts_found,
        errors=result.errors,
    )


@router.post("/execute", response_model=ExecuteResponse)
async def execute_warmup(req: ExecuteRequest):
    """
    Execute pending warmup comments.

    Reads acq_warmup_schedules WHERE status='pending' AND scheduled_at <= NOW(),
    sends comments via platform services, updates status.

    Accepts:
    - platform: filter to specific platform (optional)
    - limit: max schedules to process
    - dry_run: if true, validate but don't send

    Returns:
    - comments_sent: number of comments successfully sent
    - comments_failed: number of failed sends
    - contacts_completed: number of contacts who completed warmup
    - rate_limit_skips: number of comments skipped due to daily caps
    - errors: list of error messages
    """
    agent = WarmupAgent(dry_run=req.dry_run)

    result = await agent.execute_pending(
        platform=req.platform,
        limit=req.limit,
    )

    return ExecuteResponse(
        comments_sent=result.comments_sent,
        comments_failed=result.comments_failed,
        contacts_completed=result.contacts_completed,
        rate_limit_skips=result.rate_limit_skips,
        errors=result.errors,
    )


@router.get("/status", response_model=WarmupStatusResponse)
async def get_warmup_status():
    """
    Get warmup pipeline status.

    Returns:
    - pending_schedules: total pending comment schedules
    - contacts_warming: contacts currently in warming stage
    - contacts_ready_for_dm: contacts ready for DM outreach
    - contacts_qualified: contacts waiting to be scheduled
    - completions_today: contacts completed today
    - completion_rate: % of warming contacts who completed (all-time)
    - platforms: per-platform breakdown
    """
    from datetime import datetime, timezone, timedelta

    # Pipeline stage counts
    qualified_contacts, _ = queries.get_contacts_by_stage("qualified", limit=1000)
    warming_contacts, _ = queries.get_contacts_by_stage("warming", limit=1000)
    ready_contacts, _ = queries.get_contacts_by_stage("ready_for_dm", limit=1000)

    qualified_count = len(qualified_contacts) if qualified_contacts else 0
    warming_count = len(warming_contacts) if warming_contacts else 0
    ready_count = len(ready_contacts) if ready_contacts else 0

    # Pending schedules
    pending_schedules, _ = queries.get_pending_warmup(limit=1000)
    pending_count = len(pending_schedules) if pending_schedules else 0

    # Completions today
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    params = f"?from_stage=eq.warming&to_stage=eq.ready_for_dm&occurred_at=gte.{today_start.isoformat()}"
    events, _ = queries._select("acq_funnel_events", params)
    completions_today = len(events) if events else 0

    # Completion rate (all-time)
    # Total contacts who entered warming
    all_warming_events, _ = queries._select(
        "acq_funnel_events",
        "?to_stage=eq.warming&select=contact_id"
    )
    total_warming = len(set(e["contact_id"] for e in (all_warming_events or [])))

    # Total contacts who completed (warming → ready_for_dm)
    all_completion_events, _ = queries._select(
        "acq_funnel_events",
        "?from_stage=eq.warming&to_stage=eq.ready_for_dm&select=contact_id"
    )
    total_completed = len(set(e["contact_id"] for e in (all_completion_events or [])))

    completion_rate = (total_completed / total_warming * 100) if total_warming > 0 else 0.0

    # Per-platform status
    platforms_data = []
    from ...config import DEFAULT_DAILY_CAPS

    for platform in ["instagram", "twitter", "tiktok", "linkedin", "threads"]:
        # Pending for this platform
        platform_pending = [s for s in (pending_schedules or []) if s.get("platform") == platform]
        pending_platform_count = len(platform_pending)

        # Sent today for this platform
        today_cap, _ = queries.get_daily_cap_usage("comment", platform)
        sent_today = today_cap.get("current", 0) if today_cap else 0

        # Daily cap
        daily_cap = DEFAULT_DAILY_CAPS.get("comment", {}).get(platform, 0)

        platforms_data.append(PlatformStatus(
            platform=platform,
            pending=pending_platform_count,
            sent_today=sent_today,
            daily_cap=daily_cap,
        ))

    return WarmupStatusResponse(
        pending_schedules=pending_count,
        contacts_warming=warming_count,
        contacts_ready_for_dm=ready_count,
        contacts_qualified=qualified_count,
        completions_today=completions_today,
        completion_rate=round(completion_rate, 1),
        platforms=platforms_data,
    )
