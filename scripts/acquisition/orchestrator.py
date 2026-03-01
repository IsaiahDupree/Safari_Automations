"""
acquisition/orchestrator.py — Central Acquisition Orchestrator.

Ties all agents together: state machine enforcement, daily cap management,
cron scheduling, emergency pause/resume, and pipeline status.

Usage:
    python3 acquisition/orchestrator.py --status
    python3 acquisition/orchestrator.py --run-all
    python3 acquisition/orchestrator.py --step discovery
    python3 acquisition/orchestrator.py --dry-run
    python3 acquisition/orchestrator.py --pause
    python3 acquisition/orchestrator.py --resume
"""

import argparse
import asyncio
import json
import sys
import time
import traceback
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from .config import ENABLE_ACQUISITION
from .daily_caps import DailyCapsManager
from .db import queries
from .state_machine import validate_transition, InvalidTransitionError


# ── Data Classes ─────────────────────────────────────────────────────────────

@dataclass
class StepResult:
    step: str = ""
    skipped: bool = False
    reason: str = ""
    success: bool = False
    processed: int = 0
    errors: list[str] = field(default_factory=list)
    duration_ms: int = 0


# ── System State (pause/resume) ─────────────────────────────────────────────

def _get_system_state(key: str) -> Optional[str]:
    """Read a value from acq_system_state."""
    rows, err = queries._select("acq_system_state", f"?key=eq.{key}")
    if err or not rows:
        return None
    return rows[0].get("value")


def _set_system_state(key: str, value: str) -> bool:
    """Write a value to acq_system_state (upsert)."""
    _, err = queries._upsert("acq_system_state", [
        {"key": key, "value": value, "updated_at": queries._utcnow()}
    ], on_conflict="key")
    return err is None


def is_paused() -> bool:
    """Check if acquisition system is paused."""
    import os
    if os.environ.get("ACQUISITION_PAUSED", "").lower() == "true":
        return True
    val = _get_system_state("acquisition_paused")
    return val == "true"


def set_paused(paused: bool) -> bool:
    """Set or clear the acquisition pause flag."""
    return _set_system_state("acquisition_paused", "true" if paused else "false")


# ── Orchestrator ─────────────────────────────────────────────────────────────

# Step ordering for --run-all
STEP_ORDER = [
    "discovery",
    "entity_resolve",
    "scoring",
    "email_discover",
    "warmup_schedule",
    "warmup_execute",
    "outreach",
    "email_send",
    "sync_followup",
]


class AcquisitionOrchestrator:
    def __init__(self):
        self.caps = DailyCapsManager()

    def _run_async(self, coro):
        """Run an async coroutine from synchronous context."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return asyncio.run(coro)

    def run_step(self, step: str, dry_run: bool = False) -> StepResult:
        """Run a single orchestration step."""
        result = StepResult(step=step)
        start = time.monotonic()

        # Gate checks
        if not ENABLE_ACQUISITION and not dry_run:
            result.skipped = True
            result.reason = "ENABLE_ACQUISITION=false"
            return result

        if is_paused():
            result.skipped = True
            result.reason = "system_paused"
            return result

        # Dispatch to step handler
        steps = {
            "discovery":       self._step_discovery,
            "scoring":         self._step_scoring,
            "warmup_schedule": self._step_warmup_schedule,
            "warmup_execute":  self._step_warmup_execute,
            "email_discover":  self._step_email_discover,
            "outreach":        self._step_outreach,
            "email_send":      self._step_email_send,
            "sync_followup":   self._step_sync_followup,
            "entity_resolve":  self._step_entity_resolve,
            "report":          self._step_report,
        }

        fn = steps.get(step)
        if not fn:
            result.errors.append(f"Unknown step: {step}")
            return result

        result = self._run_with_retry(fn, step, dry_run, max_retries=3)
        result.duration_ms = int((time.monotonic() - start) * 1000)
        return result

    def _run_with_retry(
        self, fn, step: str, dry_run: bool, max_retries: int = 3
    ) -> StepResult:
        """Execute a step function with exponential backoff retries."""
        delays = [300, 900, 3600]  # 5min, 15min, 1hr
        last_error = ""

        for attempt in range(max_retries):
            try:
                return fn(dry_run=dry_run)
            except Exception as e:
                last_error = f"Attempt {attempt + 1}/{max_retries}: {e}"
                if attempt < max_retries - 1:
                    wait = delays[attempt] if not dry_run else 0
                    if wait > 0:
                        time.sleep(wait)
                else:
                    return StepResult(
                        step=step,
                        success=False,
                        errors=[last_error, traceback.format_exc()],
                    )
        # Should not reach here
        return StepResult(step=step, errors=[last_error])

    def run_all(self, dry_run: bool = False) -> list[StepResult]:
        """Run all steps in order. Continues even if a step fails."""
        results = []
        for step in STEP_ORDER:
            result = self.run_step(step, dry_run=dry_run)
            results.append(result)
            if result.skipped and result.reason in ("ENABLE_ACQUISITION=false", "system_paused"):
                # If globally blocked, no point running the rest
                for remaining in STEP_ORDER[STEP_ORDER.index(step) + 1:]:
                    results.append(StepResult(step=remaining, skipped=True, reason=result.reason))
                break
        return results

    def get_status(self) -> dict:
        """Pipeline snapshot for the status endpoint / CLI."""
        stage_counts, err = queries.get_pipeline_snapshot()
        if err:
            stage_counts = {}

        cap_usage = self.caps.get_usage_summary()
        paused = is_paused()

        return {
            "paused": paused,
            "enable_acquisition": ENABLE_ACQUISITION,
            "pipeline": stage_counts,
            "caps": cap_usage,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    # ── Step Implementations ─────────────────────────────────────────────────
    # Each step delegates to the corresponding agent.

    def _step_discovery(self, dry_run: bool = False) -> StepResult:
        """Run discovery agent to find new prospects."""
        result = StepResult(step="discovery", success=True)
        if dry_run:
            result.reason = "dry_run"
            return result
        from .discovery_agent import DiscoveryAgent
        agent = DiscoveryAgent(dry_run=dry_run)
        dr = self._run_async(agent.run())
        result.processed = dr.seeded
        result.success = len(dr.errors) == 0
        result.errors = dr.errors
        result.reason = f"discovered={dr.discovered} dedup={dr.deduplicated} seeded={dr.seeded}"
        return result

    def _step_scoring(self, dry_run: bool = False) -> StepResult:
        """Run scoring agent on unscored contacts."""
        result = StepResult(step="scoring", success=True)
        if dry_run:
            result.reason = "dry_run"
            return result
        from .scoring_agent import ScoringAgent
        agent = ScoringAgent(dry_run=dry_run)
        sr = self._run_async(agent.run(limit=50))
        result.processed = sr.total_scored
        result.success = len(sr.errors) == 0
        result.errors = sr.errors
        result.reason = f"scored={sr.total_scored} qualified={sr.qualified_count} archived={sr.archived_count}"
        return result

    def _step_warmup_schedule(self, dry_run: bool = False) -> StepResult:
        """Schedule warmup comments for qualified contacts."""
        result = StepResult(step="warmup_schedule", success=True)
        if dry_run:
            result.reason = "dry_run"
            return result
        contacts, err = queries.get_qualified_contacts(limit=50)
        if err:
            result.errors.append(f"Failed to load contacts: {err}")
            result.success = False
            return result
        result.processed = len(contacts)
        result.reason = f"{len(contacts)} contacts for warmup scheduling"
        return result

    def _step_warmup_execute(self, dry_run: bool = False) -> StepResult:
        """Execute pending warmup comments."""
        result = StepResult(step="warmup_execute", success=True)
        if dry_run:
            result.reason = "dry_run"
            return result
        pending, err = queries.get_pending_warmup(limit=50)
        if err:
            result.errors.append(f"Failed to load warmup schedules: {err}")
            result.success = False
            return result
        executed = 0
        for wp in pending:
            platform = wp.get("platform", "unknown")
            if not self.caps.check("comment", platform):
                result.errors.append(f"Cap reached for comment/{platform}")
                continue
            self.caps.increment("comment", platform)
            executed += 1
        result.processed = executed
        result.success = True
        return result

    def reschedule_capped_outreach(self, seq_id: str) -> bool:
        """Reschedule a capped outreach sequence to tomorrow 9AM.

        When a contact's DM is skipped due to daily cap, the contact stays in
        the pipeline and is rescheduled for the next day rather than archived.
        """
        _, err = queries.reschedule_outreach_to_tomorrow(seq_id)
        return err is None

    def _step_email_discover(self, dry_run: bool = False) -> StepResult:
        """Discover email addresses for qualified contacts."""
        result = StepResult(step="email_discover", success=True)
        if dry_run:
            result.reason = "dry_run"
            return result
        from .email_agent import EmailAgent
        agent = EmailAgent()
        stats = self._run_async(agent.discover_emails(limit=20, dry_run=dry_run))
        result.processed = stats.get("total_found", 0)
        result.reason = f"emails found: {result.processed}"
        return result

    def _step_outreach(self, dry_run: bool = False) -> StepResult:
        """Send DM outreach to ready contacts."""
        result = StepResult(step="outreach", success=True)
        if dry_run:
            result.reason = "dry_run"
            return result
        from .outreach_agent import OutreachAgent
        agent = OutreachAgent()
        or_ = self._run_async(agent.run(limit=10, dry_run=dry_run))
        result.processed = or_.successful
        result.success = or_.failed == 0
        result.reason = f"sent={or_.successful} failed={or_.failed} skipped={or_.skipped}"
        return result

    def _step_email_send(self, dry_run: bool = False) -> StepResult:
        """Send pending email sequences."""
        result = StepResult(step="email_send", success=True)
        if dry_run:
            result.reason = "dry_run"
            return result
        from .email_agent import EmailAgent
        agent = EmailAgent()
        stats = self._run_async(agent.send_pending(limit=30, dry_run=dry_run))
        result.processed = stats.get("sent", 0)
        result.reason = f"sent={result.processed}"
        return result

    def _step_sync_followup(self, dry_run: bool = False) -> StepResult:
        """Sync inboxes, detect replies, schedule follow-ups."""
        result = StepResult(step="sync_followup", success=True)
        if dry_run:
            result.reason = "dry_run"
            return result
        from . import followup_agent
        self._run_async(followup_agent.process_followups(dry_run=dry_run))
        result.reason = "follow-up sync complete"
        return result

    def _step_entity_resolve(self, dry_run: bool = False) -> StepResult:
        """Resolve cross-platform entity associations."""
        result = StepResult(step="entity_resolve", success=True)
        if dry_run:
            result.reason = "dry_run"
            return result
        from .entity_resolution_agent import resolve_unresolved_batch
        results = self._run_async(resolve_unresolved_batch(limit=20))
        result.processed = len(results)
        confirmed = sum(1 for r in results if not r.error)
        result.reason = f"resolved={confirmed}/{len(results)}"
        result.success = True
        return result

    def _step_report(self, dry_run: bool = False) -> StepResult:
        """Generate weekly pipeline report."""
        result = StepResult(step="report", success=True)
        if dry_run:
            result.reason = "dry_run"
            return result
        from . import reporting_agent
        today = date.today()
        # Find most recent Monday
        week_start = today - timedelta(days=today.weekday())
        report = reporting_agent.generate_report(
            week_start=week_start, deliver=True, dry_run=False
        )
        result.processed = 1
        result.reason = f"report generated for week of {week_start}"
        return result


# ── CLI ──────────────────────────────────────────────────────────────────────

def _print_status(status: dict) -> None:
    """Pretty-print pipeline status to stdout."""
    print("\n=== Acquisition Pipeline Status ===\n")
    print(f"  Enabled:  {status['enable_acquisition']}")
    print(f"  Paused:   {status['paused']}")
    print(f"  Time:     {status['timestamp']}\n")

    print("  Pipeline Stages:")
    for stage, count in status["pipeline"].items():
        bar = "#" * min(count, 40)
        print(f"    {stage:>15s}: {count:>4d}  {bar}")

    print("\n  Daily Cap Usage:")
    for key, usage in status["caps"].items():
        print(f"    {key:>25s}: {usage}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Acquisition Orchestrator")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--status", action="store_true", help="Pipeline snapshot")
    group.add_argument("--run-all", action="store_true", help="Run all steps in order")
    group.add_argument("--step", type=str, help="Run a single step")
    group.add_argument("--dry-run", action="store_true", help="Full run, no sends")
    group.add_argument("--pause", action="store_true", help="Emergency stop")
    group.add_argument("--resume", action="store_true", help="Resume from pause")
    group.add_argument("--seed", action="store_true", help="Seed default data")
    args = parser.parse_args()

    orch = AcquisitionOrchestrator()

    if args.status:
        status = orch.get_status()
        _print_status(status)

    elif args.run_all:
        results = orch.run_all()
        for r in results:
            icon = "OK" if r.success else ("SKIP" if r.skipped else "FAIL")
            print(f"  [{icon:>4s}] {r.step:>20s}  processed={r.processed}  {r.reason}")
            for e in r.errors:
                print(f"         err: {e[:120]}")

    elif args.step:
        result = orch.run_step(args.step)
        print(json.dumps(asdict(result), indent=2))

    elif args.dry_run:
        results = orch.run_all(dry_run=True)
        for r in results:
            icon = "DRY" if r.reason == "dry_run" else ("SKIP" if r.skipped else "FAIL")
            print(f"  [{icon:>4s}] {r.step:>20s}  {r.reason}")

    elif args.pause:
        ok = set_paused(True)
        print("Acquisition PAUSED" if ok else "Failed to pause")
        sys.exit(0 if ok else 1)

    elif args.resume:
        ok = set_paused(False)
        print("Acquisition RESUMED" if ok else "Failed to resume")
        sys.exit(0 if ok else 1)

    elif args.seed:
        results = queries.seed_all()
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
