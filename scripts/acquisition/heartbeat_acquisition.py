"""
acquisition/heartbeat_acquisition.py — Acquisition pipeline health check for heartbeat integration.

Adds acquisition pipeline metrics to the system heartbeat: pipeline stage counts,
today's send stats, last agent run times, and cap usage.

Usage:
    from acquisition.heartbeat_acquisition import get_acquisition_health
    health = get_acquisition_health()
"""

from datetime import datetime, timezone
from typing import Any

from .daily_caps import DailyCapsManager
from .db import queries
from .orchestrator import is_paused
from .config import ENABLE_ACQUISITION


def get_acquisition_health() -> dict[str, Any]:
    """Return acquisition pipeline health data for heartbeat integration.

    Returns a dict suitable for inclusion in HEARTBEAT.md daily notes:
    - pipeline: stage counts
    - caps: daily cap usage
    - status: paused/enabled flags
    - agent_health: last run times per agent
    """
    # Pipeline stage counts
    stage_counts, err = queries.get_pipeline_snapshot()
    if err:
        stage_counts = {"error": err}

    # Daily cap usage
    caps = DailyCapsManager()
    cap_usage = caps.get_usage_summary()

    # Agent health: last discovery run timestamp
    runs, _ = queries.get_recent_discovery_runs(limit=1)
    last_discovery = runs[0]["run_at"] if runs else None

    # Latest report
    report, _ = queries.get_latest_report()
    last_report = report.get("created_at") if report else None

    total_contacts = sum(stage_counts.values()) if isinstance(stage_counts, dict) and "error" not in stage_counts else 0

    return {
        "enabled": ENABLE_ACQUISITION,
        "paused": is_paused(),
        "total_contacts": total_contacts,
        "pipeline": stage_counts,
        "caps": cap_usage,
        "agent_health": {
            "last_discovery_run": last_discovery,
            "last_report": last_report,
        },
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def format_heartbeat_section() -> str:
    """Format acquisition health as a markdown section for HEARTBEAT.md."""
    health = get_acquisition_health()

    lines = [
        "## Acquisition Pipeline",
        "",
        f"- **Enabled:** {health['enabled']}",
        f"- **Paused:** {health['paused']}",
        f"- **Total Contacts:** {health['total_contacts']}",
        "",
    ]

    if isinstance(health["pipeline"], dict) and "error" not in health["pipeline"]:
        lines.append("### Pipeline Stages")
        for stage, count in health["pipeline"].items():
            lines.append(f"  - {stage}: {count}")
        lines.append("")

    lines.append("### Daily Cap Usage")
    for key, usage in health["caps"].items():
        lines.append(f"  - {key}: {usage}")
    lines.append("")

    agent_health = health["agent_health"]
    lines.append("### Agent Health")
    lines.append(f"  - Last Discovery: {agent_health['last_discovery_run'] or 'never'}")
    lines.append(f"  - Last Report: {agent_health['last_report'] or 'never'}")
    lines.append("")

    return "\n".join(lines)
