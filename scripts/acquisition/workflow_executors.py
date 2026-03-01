"""
acquisition/workflow_executors.py — AcquisitionExecutor for actp-worker integration.

Maps task types to acquisition agent modules so the workflow engine can
dispatch acquisition steps as standard tasks.

Usage:
    from acquisition.workflow_executors import AcquisitionExecutor
    executor = AcquisitionExecutor()
    result = await executor.execute(task_type, params)
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class TaskResult:
    task_type: str
    success: bool = False
    processed: int = 0
    errors: list[str] = field(default_factory=list)
    data: dict = field(default_factory=dict)


class AcquisitionExecutor:
    """Executor that delegates actp-worker tasks to acquisition agent modules."""

    TASK_TYPES = [
        "acquisition_discovery",
        "icp_scoring",
        "engagement_warmup",
        "dm_outreach",
        "inbox_sync",
        "followup_sequence",
        "pipeline_report",
        "acquisition_entity_resolution",
        "acquisition_email_discovery",
        "acquisition_email_send",
    ]

    def __init__(self):
        self._handlers = {
            "acquisition_discovery": self._run_discovery,
            "icp_scoring": self._run_scoring,
            "engagement_warmup": self._run_warmup,
            "dm_outreach": self._run_outreach,
            "inbox_sync": self._run_sync_followup,
            "followup_sequence": self._run_followup,
            "pipeline_report": self._run_report,
            "acquisition_entity_resolution": self._run_entity_resolve,
            "acquisition_email_discovery": self._run_email_discover,
            "acquisition_email_send": self._run_email_send,
        }

    async def execute(self, task_type: str, params: Optional[dict] = None) -> TaskResult:
        """Execute a task by type. Returns TaskResult."""
        handler = self._handlers.get(task_type)
        if not handler:
            return TaskResult(
                task_type=task_type,
                errors=[f"Unknown task type: {task_type}. Valid: {self.TASK_TYPES}"],
            )
        params = params or {}
        try:
            return await handler(**params)
        except Exception as e:
            return TaskResult(task_type=task_type, errors=[str(e)])

    def can_handle(self, task_type: str) -> bool:
        return task_type in self._handlers

    async def _run_discovery(self, dry_run: bool = False, **kwargs) -> TaskResult:
        from .discovery_agent import DiscoveryAgent
        agent = DiscoveryAgent(dry_run=dry_run)
        dr = await agent.run()
        return TaskResult(
            task_type="acquisition_discovery",
            success=len(dr.errors) == 0,
            processed=dr.seeded,
            data={"discovered": dr.discovered, "deduplicated": dr.deduplicated},
        )

    async def _run_scoring(self, limit: int = 50, dry_run: bool = False, **kwargs) -> TaskResult:
        from .scoring_agent import ScoringAgent
        agent = ScoringAgent(dry_run=dry_run)
        sr = await agent.run(limit=limit)
        return TaskResult(
            task_type="icp_scoring",
            success=len(sr.errors) == 0,
            processed=sr.total_scored,
            data={"qualified": sr.qualified_count, "archived": sr.archived_count},
        )

    async def _run_warmup(self, dry_run: bool = False, **kwargs) -> TaskResult:
        from .orchestrator import AcquisitionOrchestrator
        orch = AcquisitionOrchestrator()
        result = orch._step_warmup_execute(dry_run=dry_run)
        return TaskResult(
            task_type="engagement_warmup",
            success=result.success,
            processed=result.processed,
            errors=result.errors,
        )

    async def _run_outreach(self, limit: int = 10, dry_run: bool = False, **kwargs) -> TaskResult:
        from .outreach_agent import OutreachAgent
        agent = OutreachAgent()
        or_ = await agent.run(limit=limit, dry_run=dry_run)
        return TaskResult(
            task_type="dm_outreach",
            success=or_.failed == 0,
            processed=or_.successful,
            data={"failed": or_.failed, "skipped": or_.skipped},
        )

    async def _run_sync_followup(self, dry_run: bool = False, **kwargs) -> TaskResult:
        from . import followup_agent
        await followup_agent.process_followups(dry_run=dry_run)
        return TaskResult(task_type="inbox_sync", success=True)

    async def _run_followup(self, dry_run: bool = False, **kwargs) -> TaskResult:
        from . import followup_agent
        await followup_agent.process_followups(dry_run=dry_run)
        return TaskResult(task_type="followup_sequence", success=True)

    async def _run_report(self, dry_run: bool = False, **kwargs) -> TaskResult:
        from . import reporting_agent
        from datetime import date, timedelta
        today = date.today()
        week_start = today - timedelta(days=today.weekday())
        reporting_agent.generate_report(week_start=week_start, deliver=not dry_run, dry_run=dry_run)
        return TaskResult(task_type="pipeline_report", success=True, processed=1)

    async def _run_entity_resolve(self, limit: int = 20, dry_run: bool = False, **kwargs) -> TaskResult:
        from .entity_resolution_agent import resolve_unresolved_batch
        results = await resolve_unresolved_batch(limit=limit)
        confirmed = sum(1 for r in results if not r.error)
        return TaskResult(
            task_type="acquisition_entity_resolution",
            success=True,
            processed=confirmed,
            data={"total": len(results)},
        )

    async def _run_email_discover(self, limit: int = 20, dry_run: bool = False, **kwargs) -> TaskResult:
        from .email_agent import EmailAgent
        agent = EmailAgent()
        stats = await agent.discover_emails(limit=limit, dry_run=dry_run)
        return TaskResult(
            task_type="acquisition_email_discovery",
            success=True,
            processed=stats.get("total_found", 0),
        )

    async def _run_email_send(self, limit: int = 30, dry_run: bool = False, **kwargs) -> TaskResult:
        from .email_agent import EmailAgent
        agent = EmailAgent()
        stats = await agent.send_pending(limit=limit, dry_run=dry_run)
        return TaskResult(
            task_type="acquisition_email_send",
            success=True,
            processed=stats.get("sent", 0),
        )
