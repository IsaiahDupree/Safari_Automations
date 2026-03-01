"""
acquisition/api/server.py — FastAPI application for the Acquisition Pipeline API.

Run: uvicorn acquisition.api.server:app --port 8000
"""

from fastapi import FastAPI

from .routes.orchestrator import router as orchestrator_router
from .routes.email import router as email_router
from .routes.outreach import router as outreach_router
from .routes.discovery import router as discovery_router
from .routes.warmup import router as warmup_router
from ..daily_caps import DailyCapsManager
from ..db import queries
from ..state_machine import ALL_STAGES

app = FastAPI(
    title="Acquisition API",
    version="1.0.0",
    description="Autonomous Acquisition Agent pipeline orchestration and monitoring.",
)

# ── Routers ──────────────────────────────────────────────────────────────────

app.include_router(orchestrator_router, prefix="/api/acquisition/orchestrator")
app.include_router(email_router)  # Already includes /api/acquisition/email prefix
app.include_router(outreach_router)  # Already includes /api/acquisition/outreach prefix
app.include_router(discovery_router, prefix="/api/acquisition/discovery")
app.include_router(warmup_router)  # Already includes /api/acquisition/warmup prefix

# Placeholder routers for agents 06, 09, 10.
# Uncomment as each agent's routes are implemented:
# app.include_router(followup_router,    prefix="/api/acquisition/followup")
# app.include_router(entity_router,      prefix="/api/acquisition/entity")
# app.include_router(reports_router,     prefix="/api/acquisition/reports")


# ── Top-level Endpoints ─────────────────────────────────────────────────────

@app.get("/api/acquisition/status")
def pipeline_status():
    """Top-level dashboard: pipeline stage counts + today stats + cap usage."""
    caps = DailyCapsManager()
    stage_counts, _ = queries.get_pipeline_snapshot()

    cap_usage = caps.get_usage_summary()

    return {
        "pipeline": stage_counts,
        "caps": cap_usage,
    }


@app.get("/api/acquisition/dashboard")
def acquisition_dashboard():
    """Comprehensive single-call dashboard for a future web UI.

    Returns pipeline snapshot + today stats + agent health + cap usage
    in one request.
    """
    from ..orchestrator import is_paused
    from ..config import ENABLE_ACQUISITION
    from datetime import datetime, timezone

    caps_mgr = DailyCapsManager()
    stage_counts, _ = queries.get_pipeline_snapshot()
    today_stats, _ = queries.get_today_stats()
    cap_usage = caps_mgr.get_usage_summary()

    # Agent health: last runs
    runs, _ = queries.get_recent_discovery_runs(limit=1)
    last_discovery = runs[0]["run_at"] if runs else None

    report, _ = queries.get_latest_report()
    last_report = report.get("created_at") if report else None
    report_summary = None
    if report:
        report_summary = {
            "week_start": report.get("week_start"),
            "week_end": report.get("week_end"),
            "dms_sent": report.get("dms_sent", 0),
            "replies_received": report.get("replies_received", 0),
            "reply_rate": float(report.get("reply_rate", 0)),
        }

    return {
        "enabled": ENABLE_ACQUISITION,
        "paused": is_paused(),
        "pipeline": stage_counts,
        "today": today_stats,
        "caps": cap_usage,
        "agent_health": {
            "last_discovery_run": last_discovery,
            "last_report": last_report,
        },
        "latest_report_summary": report_summary,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/health")
def health():
    return {"status": "ok"}
