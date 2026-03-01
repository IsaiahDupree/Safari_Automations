"""
acquisition/api/routes/orchestrator.py — Orchestrator API endpoints.

Provides: pipeline status, run steps, pause/resume, daily caps.
"""

from fastapi import APIRouter, HTTPException

from ..schemas import (
    PipelineStatus,
    StepRunRequest,
    StepRunResponse,
    PauseResumeResponse,
)
from ...orchestrator import (
    AcquisitionOrchestrator,
    is_paused,
    set_paused,
    STEP_ORDER,
)

router = APIRouter(tags=["orchestrator"])

_orch = AcquisitionOrchestrator()


@router.get("/status", response_model=PipelineStatus)
def get_pipeline_status():
    """Full pipeline snapshot: stage counts, cap usage, pause state."""
    return _orch.get_status()


@router.post("/run", response_model=StepRunResponse)
def run_step(req: StepRunRequest):
    """Run a single orchestration step."""
    if req.step not in STEP_ORDER and req.step != "report":
        raise HTTPException(400, f"Unknown step '{req.step}'. Valid: {STEP_ORDER + ['report']}")
    result = _orch.run_step(req.step, dry_run=req.dry_run)
    return StepRunResponse(
        step=result.step,
        skipped=result.skipped,
        reason=result.reason,
        success=result.success,
        processed=result.processed,
        errors=result.errors,
        duration_ms=result.duration_ms,
    )


@router.post("/run-all", response_model=list[StepRunResponse])
def run_all(dry_run: bool = False):
    """Run all steps in order."""
    results = _orch.run_all(dry_run=dry_run)
    return [
        StepRunResponse(
            step=r.step,
            skipped=r.skipped,
            reason=r.reason,
            success=r.success,
            processed=r.processed,
            errors=r.errors,
            duration_ms=r.duration_ms,
        )
        for r in results
    ]


@router.post("/pause", response_model=PauseResumeResponse)
def pause_acquisition():
    """Emergency pause — blocks all steps."""
    ok = set_paused(True)
    if not ok:
        raise HTTPException(500, "Failed to set pause flag")
    return PauseResumeResponse(paused=True, message="Acquisition paused")


@router.post("/resume", response_model=PauseResumeResponse)
def resume_acquisition():
    """Resume from pause."""
    ok = set_paused(False)
    if not ok:
        raise HTTPException(500, "Failed to clear pause flag")
    return PauseResumeResponse(paused=False, message="Acquisition resumed")


@router.get("/caps")
def get_caps():
    """Current daily cap usage."""
    return _orch.caps.get_usage_summary()


@router.post("/caps/reset")
def reset_caps():
    """Manually reset all daily caps (normally runs at midnight)."""
    _orch.caps.reset_all()
    return {"message": "Daily caps reset"}


@router.post("/seed")
def seed_data():
    """Seed default niche configs and daily caps."""
    from ...db import queries
    results = queries.seed_all()
    return results
