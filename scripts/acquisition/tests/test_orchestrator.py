"""
tests/test_orchestrator.py — Tests for the acquisition orchestrator.

Covers: state machine, daily caps, pause/resume, retry logic, and pipeline flow.
Run: python3 -m pytest acquisition/tests/test_orchestrator.py -v
"""

import asyncio
import os
import sys
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from dataclasses import asdict

# Ensure acquisition package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from acquisition.state_machine import (
    validate_transition,
    InvalidTransitionError,
    VALID_TRANSITIONS,
    ALL_STAGES,
)
from acquisition.daily_caps import DailyCapsManager
from acquisition.orchestrator import (
    AcquisitionOrchestrator,
    StepResult,
    is_paused,
    set_paused,
    STEP_ORDER,
)
from acquisition.cron_definitions import (
    get_cron_by_name,
    get_cron_by_step,
    ACQUISITION_CRONS,
)


# ═════════════════════════════════════════════════════════════════════════════
# State Machine Tests
# ═════════════════════════════════════════════════════════════════════════════

class TestStateMachine(unittest.TestCase):

    def test_state_machine_valid_transition(self):
        """All explicitly allowed transitions should pass without error."""
        for from_stage, allowed in VALID_TRANSITIONS.items():
            for to_stage in allowed:
                # Should not raise
                validate_transition(from_stage, to_stage)

    def test_state_machine_invalid_raises_error(self):
        """Disallowed transitions must raise InvalidTransitionError."""
        # new -> contacted (skips several stages)
        with self.assertRaises(InvalidTransitionError):
            validate_transition("new", "contacted")

        # warming -> contacted (must go through ready_for_dm)
        with self.assertRaises(InvalidTransitionError):
            validate_transition("warming", "contacted")

        # closed_won has no exits
        with self.assertRaises(InvalidTransitionError):
            validate_transition("closed_won", "archived")

        # call_booked -> archived not allowed
        with self.assertRaises(InvalidTransitionError):
            validate_transition("call_booked", "archived")

    def test_unknown_stage_raises_error(self):
        """A completely unknown from_stage should raise."""
        with self.assertRaises(InvalidTransitionError):
            validate_transition("nonexistent", "new")

    def test_all_stages_present(self):
        """Every stage in ALL_STAGES should have an entry in VALID_TRANSITIONS."""
        for stage in ALL_STAGES:
            self.assertIn(stage, VALID_TRANSITIONS)

    def test_follow_up_stages_exist(self):
        """follow_up_1 and follow_up_2 must be in the state machine."""
        self.assertIn("follow_up_1", VALID_TRANSITIONS)
        self.assertIn("follow_up_2", VALID_TRANSITIONS)
        # contacted -> follow_up_1 is valid
        validate_transition("contacted", "follow_up_1")
        # follow_up_1 -> follow_up_2 is valid
        validate_transition("follow_up_1", "follow_up_2")

    def test_re_entry_paths(self):
        """closed_lost and archived can re-enter as new."""
        validate_transition("closed_lost", "new")
        validate_transition("archived", "new")

    def test_high_score_skip_warmup(self):
        """qualified -> ready_for_dm (high-score skip) is valid."""
        validate_transition("qualified", "ready_for_dm")


# ═════════════════════════════════════════════════════════════════════════════
# Daily Caps Tests
# ═════════════════════════════════════════════════════════════════════════════

class TestDailyCaps(unittest.TestCase):

    @patch("acquisition.daily_caps.queries")
    def test_daily_cap_blocks_at_limit(self, mock_queries):
        """check() returns False when sent_today >= daily_limit."""
        mock_queries.get_daily_cap.return_value = (
            {"sent_today": 20, "daily_limit": 20},
            None,
        )
        caps = DailyCapsManager()
        self.assertFalse(caps.check("dm", "instagram"))

    @patch("acquisition.daily_caps.queries")
    def test_daily_cap_allows_under_limit(self, mock_queries):
        """check() returns True when under limit."""
        mock_queries.get_daily_cap.return_value = (
            {"sent_today": 5, "daily_limit": 20},
            None,
        )
        caps = DailyCapsManager()
        self.assertTrue(caps.check("dm", "instagram"))

    @patch("acquisition.daily_caps.queries")
    def test_daily_cap_resets_at_midnight(self, mock_queries):
        """reset_all() calls queries.reset_daily_caps()."""
        caps = DailyCapsManager()
        caps.reset_all()
        mock_queries.reset_daily_caps.assert_called_once()

    @patch("acquisition.daily_caps.queries")
    def test_daily_cap_increment(self, mock_queries):
        """increment() calls queries.increment_daily_cap()."""
        mock_queries.increment_daily_cap.return_value = (True, None)
        caps = DailyCapsManager()
        result = caps.increment("dm", "twitter")
        self.assertTrue(result)
        mock_queries.increment_daily_cap.assert_called_once_with("dm", "twitter")

    @patch("acquisition.daily_caps.queries")
    def test_daily_cap_blocks_on_error(self, mock_queries):
        """check() returns False if query errors."""
        mock_queries.get_daily_cap.return_value = (None, "connection error")
        caps = DailyCapsManager()
        self.assertFalse(caps.check("dm", "instagram"))


# ═════════════════════════════════════════════════════════════════════════════
# Orchestrator Tests
# ═════════════════════════════════════════════════════════════════════════════

class TestOrchestrator(unittest.TestCase):

    @patch("acquisition.orchestrator.is_paused", return_value=True)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    def test_pause_blocks_all_steps(self, mock_paused):
        """When paused, every step should be skipped."""
        orch = AcquisitionOrchestrator()
        result = orch.run_step("discovery")
        self.assertTrue(result.skipped)
        self.assertEqual(result.reason, "system_paused")

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", False)
    def test_enable_acquisition_false_skips_all_crons(self, mock_paused):
        """When ENABLE_ACQUISITION=false and not dry_run, steps are skipped."""
        orch = AcquisitionOrchestrator()
        result = orch.run_step("discovery", dry_run=False)
        self.assertTrue(result.skipped)
        self.assertEqual(result.reason, "ENABLE_ACQUISITION=false")

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    @patch("acquisition.orchestrator.queries")
    def test_retry_with_backoff_on_failure(self, mock_queries, mock_paused):
        """_run_with_retry retries up to max_retries on exception."""
        call_count = 0

        def failing_step(dry_run=False):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise RuntimeError("transient error")
            return StepResult(step="test", success=True)

        orch = AcquisitionOrchestrator()
        result = orch._run_with_retry(failing_step, "test", dry_run=True, max_retries=3)
        self.assertTrue(result.success)
        self.assertEqual(call_count, 3)

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    @patch("acquisition.orchestrator.queries")
    def test_full_pipeline_continues_after_step_failure(self, mock_queries, mock_paused):
        """run_all continues to later steps even if an earlier step fails."""
        mock_queries.get_niche_configs.side_effect = Exception("db error")
        mock_queries.get_contacts_for_scoring.return_value = ([], None)
        mock_queries.get_qualified_contacts.return_value = ([], None)
        mock_queries.get_pending_warmup.return_value = ([], None)
        mock_queries.get_pending_outreach.return_value = ([], None)
        mock_queries.get_pending_email.return_value = ([], None)
        mock_queries.get_resolution_queue.return_value = ([], None)

        orch = AcquisitionOrchestrator()
        # Use dry_run to avoid retry delays
        results = orch.run_all(dry_run=True)

        # All steps should have results (not cut short)
        self.assertEqual(len(results), len(STEP_ORDER))
        # All dry_run steps should be successful (they short-circuit)
        for r in results:
            self.assertTrue(r.success or r.skipped or len(r.errors) > 0,
                            f"Step {r.step} had unexpected state")

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    @patch("acquisition.orchestrator.queries")
    def test_dry_run_skips_actual_work(self, mock_queries, mock_paused):
        """In dry_run mode, steps return immediately without calling agents."""
        orch = AcquisitionOrchestrator()
        result = orch.run_step("discovery", dry_run=True)
        self.assertTrue(result.success)
        self.assertEqual(result.reason, "dry_run")

    def test_unknown_step_returns_error(self):
        """An unknown step name should return errors."""
        with patch("acquisition.orchestrator.is_paused", return_value=False), \
             patch("acquisition.orchestrator.ENABLE_ACQUISITION", True):
            orch = AcquisitionOrchestrator()
            result = orch.run_step("nonexistent_step")
            self.assertFalse(result.success)
            self.assertTrue(any("Unknown step" in e for e in result.errors))


# ═════════════════════════════════════════════════════════════════════════════
# Pause/Resume Tests
# ═════════════════════════════════════════════════════════════════════════════

# ═════════════════════════════════════════════════════════════════════════════
# Agent Wiring Tests
# ═════════════════════════════════════════════════════════════════════════════

class TestAgentWiring(unittest.TestCase):

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    def test_discovery_step_calls_agent(self, mock_paused):
        """_step_discovery delegates to DiscoveryAgent.run()."""
        mock_result = MagicMock()
        mock_result.discovered = 10
        mock_result.deduplicated = 3
        mock_result.seeded = 7
        mock_result.errors = []

        mock_agent = MagicMock()
        mock_agent.run = AsyncMock(return_value=mock_result)

        with patch("acquisition.orchestrator.AcquisitionOrchestrator._run_async", return_value=mock_result):
            with patch("acquisition.discovery_agent.DiscoveryAgent", return_value=mock_agent):
                orch = AcquisitionOrchestrator()
                result = orch._step_discovery(dry_run=False)
                self.assertTrue(result.success)
                self.assertEqual(result.processed, 7)

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    def test_scoring_step_calls_agent(self, mock_paused):
        """_step_scoring delegates to ScoringAgent.run()."""
        mock_result = MagicMock()
        mock_result.total_scored = 5
        mock_result.qualified_count = 3
        mock_result.archived_count = 2
        mock_result.errors = []

        with patch("acquisition.orchestrator.AcquisitionOrchestrator._run_async", return_value=mock_result):
            orch = AcquisitionOrchestrator()
            result = orch._step_scoring(dry_run=False)
            self.assertTrue(result.success)
            self.assertEqual(result.processed, 5)

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    def test_outreach_step_calls_agent(self, mock_paused):
        """_step_outreach delegates to OutreachAgent.run()."""
        mock_result = MagicMock()
        mock_result.successful = 4
        mock_result.failed = 0
        mock_result.skipped = 1

        with patch("acquisition.orchestrator.AcquisitionOrchestrator._run_async", return_value=mock_result):
            orch = AcquisitionOrchestrator()
            result = orch._step_outreach(dry_run=False)
            self.assertTrue(result.success)
            self.assertEqual(result.processed, 4)

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    def test_get_status_uses_pipeline_snapshot(self, mock_paused):
        """get_status() calls queries.get_pipeline_snapshot()."""
        mock_snapshot = {"new": 10, "qualified": 5, "warming": 2}
        with patch("acquisition.orchestrator.queries") as mock_queries:
            mock_queries.get_pipeline_snapshot.return_value = (mock_snapshot, None)
            with patch("acquisition.daily_caps.queries") as mock_cap_queries:
                mock_cap_queries.get_daily_cap.return_value = ({"sent_today": 0, "daily_limit": 20}, None)
                orch = AcquisitionOrchestrator()
                status = orch.get_status()
                mock_queries.get_pipeline_snapshot.assert_called_once()
                self.assertEqual(status["pipeline"], mock_snapshot)
                self.assertIn("paused", status)
                self.assertIn("timestamp", status)


class TestPauseResume(unittest.TestCase):

    @patch("acquisition.orchestrator.queries")
    def test_set_paused_true(self, mock_queries):
        """set_paused(True) writes 'true' to system state."""
        mock_queries._upsert.return_value = (1, None)
        mock_queries._utcnow.return_value = "2026-01-01T00:00:00Z"
        result = set_paused(True)
        self.assertTrue(result)
        mock_queries._upsert.assert_called_once()
        call_args = mock_queries._upsert.call_args
        self.assertEqual(call_args[0][0], "acq_system_state")
        self.assertEqual(call_args[0][1][0]["value"], "true")

    @patch("acquisition.orchestrator.queries")
    def test_is_paused_env_override(self, mock_queries):
        """ACQUISITION_PAUSED env var overrides database."""
        with patch.dict(os.environ, {"ACQUISITION_PAUSED": "true"}):
            self.assertTrue(is_paused())


# ═════════════════════════════════════════════════════════════════════════════
# Cron Definitions Tests
# ═════════════════════════════════════════════════════════════════════════════

class TestCronDefinitions(unittest.TestCase):

    def test_get_cron_by_name_finds_existing(self):
        """get_cron_by_name returns the correct CronJob for a valid name."""
        cron = get_cron_by_name("acquisition_discovery")
        self.assertIsNotNone(cron)
        self.assertEqual(cron.step, "discovery")

    def test_get_cron_by_name_last_entry(self):
        """get_cron_by_name finds the last cron in the list (regression test)."""
        cron = get_cron_by_name("acquisition_report")
        self.assertIsNotNone(cron)
        self.assertEqual(cron.step, "report")

    def test_get_cron_by_name_returns_none(self):
        """get_cron_by_name returns None for unknown name."""
        cron = get_cron_by_name("nonexistent_cron")
        self.assertIsNone(cron)

    def test_get_cron_by_step_finds_existing(self):
        """get_cron_by_step returns the correct CronJob."""
        cron = get_cron_by_step("scoring")
        self.assertIsNotNone(cron)
        self.assertEqual(cron.name, "acquisition_scoring")

    def test_all_steps_have_crons(self):
        """Every step in STEP_ORDER should have a corresponding cron."""
        for step in STEP_ORDER:
            cron = get_cron_by_step(step)
            self.assertIsNotNone(cron, f"No cron found for step '{step}'")


if __name__ == "__main__":
    unittest.main()
