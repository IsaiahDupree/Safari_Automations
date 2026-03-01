"""
acquisition/api/schemas.py — Pydantic models for all acquisition API endpoints.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# ── Niche Config ─────────────────────────────────────────────────────────────

class NicheConfigCreate(BaseModel):
    name: str
    service_slug: str
    platforms: list[str]
    keywords: list[str]
    icp_min_score: int = 65
    skip_warmup_min_score: int | None = 85
    scoring_prompt: str | None = None
    max_weekly: int = 100


class NicheConfigUpdate(BaseModel):
    service_slug: str | None = None
    platforms: list[str] | None = None
    keywords: list[str] | None = None
    icp_min_score: int | None = None
    skip_warmup_min_score: int | None = None
    scoring_prompt: str | None = None
    max_weekly: int | None = None
    is_active: bool | None = None


# ── Discovery ────────────────────────────────────────────────────────────────

class DiscoveryRunResult(BaseModel):
    niche_config_id: str | None = None
    platform: str
    keyword: str
    discovered: int = 0
    deduplicated: int = 0
    seeded: int = 0
    errors: list[str] = Field(default_factory=list)
    duration_ms: int = 0


# ── Warmup ───────────────────────────────────────────────────────────────────

class WarmupStatus(BaseModel):
    contact_id: str
    platform: str
    comments_sent: int = 0
    comments_target: int = 3
    next_scheduled: datetime | None = None
    status: str = "pending"


# ── Outreach ─────────────────────────────────────────────────────────────────

class OutreachRequest(BaseModel):
    contact_id: str
    service_slug: str
    platform: str
    message_text: str | None = None
    touch_number: int = 1


class OutreachResult(BaseModel):
    contact_id: str
    platform: str
    status: str  # "sent", "capped", "error"
    message_id: str | None = None
    error: str | None = None


# ── Follow-Up ────────────────────────────────────────────────────────────────

class FollowUpResult(BaseModel):
    replies_detected: int = 0
    followups_scheduled: int = 0
    errors: list[str] = Field(default_factory=list)


# ── Email ────────────────────────────────────────────────────────────────────

class EmailStatus(BaseModel):
    contact_id: str
    to_email: str
    status: str  # "pending", "sent", "opened", "bounced"
    sent_at: datetime | None = None
    opened_at: datetime | None = None


# ── Entity Resolution ────────────────────────────────────────────────────────

class EntityResolutionResult(BaseModel):
    contact_id: str
    associations_found: int = 0
    associations_confirmed: int = 0
    platforms_resolved: list[str] = Field(default_factory=list)
    email_found: bool = False
    linkedin_found: bool = False


# ── Pipeline Status ──────────────────────────────────────────────────────────

class PipelineStatus(BaseModel):
    paused: bool = False
    enable_acquisition: bool = False
    pipeline: dict[str, int] = Field(default_factory=dict)
    caps: dict[str, str] = Field(default_factory=dict)
    timestamp: str = ""


# ── Weekly Report ────────────────────────────────────────────────────────────

class WeeklyReport(BaseModel):
    week_start: str
    week_end: str
    discovered: int = 0
    qualified: int = 0
    warmup_sent: int = 0
    dms_sent: int = 0
    replies_received: int = 0
    calls_booked: int = 0
    closed_won: int = 0
    qualify_rate: float = 0.0
    reply_rate: float = 0.0
    close_rate: float = 0.0
    top_platform: str | None = None
    top_niche: str | None = None
    insights: dict = Field(default_factory=dict)


# ── Orchestrator Step ────────────────────────────────────────────────────────

class StepRunRequest(BaseModel):
    step: str
    dry_run: bool = False


class StepRunResponse(BaseModel):
    step: str = ""
    skipped: bool = False
    reason: str = ""
    success: bool = False
    processed: int = 0
    errors: list[str] = Field(default_factory=list)
    duration_ms: int = 0


class PauseResumeResponse(BaseModel):
    paused: bool
    message: str
