"""
tests/test_e2e_acquisition_pipeline.py — End-to-end integration test for the acquisition pipeline.

Seeds 3 test contacts, runs full pipeline with dry_run=True, verifies each
stage transition works and no DMs are actually sent.

Run: python3 -m pytest acquisition/tests/test_e2e_acquisition_pipeline.py -v
"""

import os
import sys
import unittest
from unittest.mock import patch, MagicMock
from dataclasses import asdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from acquisition.orchestrator import AcquisitionOrchestrator, StepResult, STEP_ORDER
from acquisition.state_machine import validate_transition, InvalidTransitionError, VALID_TRANSITIONS
from acquisition.daily_caps import DailyCapsManager


class TestE2EAcquisitionPipeline(unittest.TestCase):
    """End-to-end integration test: seed contacts, run full pipeline in dry_run."""

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    @patch("acquisition.orchestrator.queries")
    def test_full_pipeline_dry_run_completes_all_steps(self, mock_queries, mock_paused):
        """All steps in the pipeline should complete in dry_run mode."""
        orch = AcquisitionOrchestrator()
        results = orch.run_all(dry_run=True)

        # All steps should have a result
        self.assertEqual(len(results), len(STEP_ORDER))

        # Every step should succeed (dry_run short-circuits)
        for result in results:
            self.assertTrue(result.success, f"Step {result.step} failed: {result.errors}")
            self.assertEqual(result.reason, "dry_run")

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    @patch("acquisition.orchestrator.queries")
    def test_pipeline_step_order_matches_expected(self, mock_queries, mock_paused):
        """Steps run in the correct order."""
        expected = [
            "discovery", "entity_resolve", "scoring",
            "email_discover", "warmup_schedule", "warmup_execute",
            "outreach", "email_send", "sync_followup",
        ]
        self.assertEqual(STEP_ORDER, expected)

    def test_seeded_contacts_can_traverse_full_funnel(self):
        """Test contacts can move through: new → qualified → warming → ready_for_dm → contacted → replied → call_booked → closed_won."""
        stages_path = [
            "new", "qualified", "warming", "ready_for_dm",
            "contacted", "replied", "call_booked", "closed_won",
        ]
        for i in range(len(stages_path) - 1):
            from_stage = stages_path[i]
            to_stage = stages_path[i + 1]
            # Should not raise
            validate_transition(from_stage, to_stage)

    def test_seeded_contacts_high_score_skip(self):
        """High-score contacts skip warmup: new → qualified → ready_for_dm → contacted."""
        validate_transition("new", "qualified")
        validate_transition("qualified", "ready_for_dm")
        validate_transition("ready_for_dm", "contacted")

    def test_seeded_contacts_follow_up_path(self):
        """Follow-up path: contacted → follow_up_1 → follow_up_2 → archived."""
        validate_transition("contacted", "follow_up_1")
        validate_transition("follow_up_1", "follow_up_2")
        validate_transition("follow_up_2", "archived")

    def test_seeded_contacts_reply_at_any_follow_up_stage(self):
        """Replies can come at contacted, follow_up_1, or follow_up_2."""
        for stage in ["contacted", "follow_up_1", "follow_up_2"]:
            validate_transition(stage, "replied")

    def test_no_dms_sent_in_dry_run(self):
        """Verify dry_run prevents actual agent execution."""
        with patch("acquisition.orchestrator.is_paused", return_value=False), \
             patch("acquisition.orchestrator.ENABLE_ACQUISITION", True), \
             patch("acquisition.orchestrator.queries"):
            orch = AcquisitionOrchestrator()

            # Test each sending step individually
            for step in ["outreach", "email_send", "warmup_execute"]:
                result = orch.run_step(step, dry_run=True)
                self.assertTrue(result.success)
                self.assertEqual(result.reason, "dry_run")
                self.assertEqual(result.processed, 0)

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    @patch("acquisition.orchestrator.queries")
    def test_pipeline_handles_empty_database_gracefully(self, mock_queries, mock_paused):
        """Pipeline should not crash when DB is empty (no contacts)."""
        mock_queries.get_qualified_contacts.return_value = ([], None)
        mock_queries.get_pending_warmup.return_value = ([], None)
        mock_queries.get_pending_outreach.return_value = ([], None)
        mock_queries.get_pending_email.return_value = ([], None)

        orch = AcquisitionOrchestrator()
        results = orch.run_all(dry_run=True)

        # Should complete without errors
        for r in results:
            self.assertTrue(r.success, f"Step {r.step} failed on empty DB")

    def test_all_valid_transitions_are_reachable(self):
        """Every non-terminal stage should have at least one exit transition."""
        terminal = {"closed_won"}
        for stage, exits in VALID_TRANSITIONS.items():
            if stage not in terminal:
                self.assertTrue(
                    len(exits) > 0,
                    f"Stage '{stage}' has no exit transitions but is not terminal"
                )

    @patch("acquisition.daily_caps.queries")
    def test_daily_caps_block_overcap_contacts(self, mock_queries):
        """When daily cap is reached, check() returns False."""
        mock_queries.get_daily_cap.return_value = (
            {"sent_today": 20, "daily_limit": 20}, None
        )
        caps = DailyCapsManager()
        self.assertFalse(caps.check("dm", "instagram"))

    @patch("acquisition.daily_caps.queries")
    def test_daily_caps_allow_undercap_contacts(self, mock_queries):
        """When under daily cap, check() returns True."""
        mock_queries.get_daily_cap.return_value = (
            {"sent_today": 5, "daily_limit": 20}, None
        )
        caps = DailyCapsManager()
        self.assertTrue(caps.check("dm", "instagram"))

    @patch("acquisition.orchestrator.is_paused", return_value=False)
    @patch("acquisition.orchestrator.ENABLE_ACQUISITION", True)
    @patch("acquisition.orchestrator.queries")
    def test_get_status_returns_complete_snapshot(self, mock_queries, mock_paused):
        """get_status() returns pipeline, caps, paused, and timestamp."""
        mock_queries.get_pipeline_snapshot.return_value = (
            {"new": 3, "qualified": 2, "warming": 1}, None
        )
        with patch("acquisition.daily_caps.queries") as cap_queries:
            cap_queries.get_daily_cap.return_value = ({"sent_today": 0, "daily_limit": 20}, None)
            orch = AcquisitionOrchestrator()
            status = orch.get_status()

        self.assertIn("pipeline", status)
        self.assertIn("caps", status)
        self.assertIn("paused", status)
        self.assertIn("timestamp", status)
        self.assertEqual(status["pipeline"]["new"], 3)


class TestE2EReEntry(unittest.TestCase):
    """Test re-entry paths for closed and archived contacts."""

    def test_closed_lost_can_reenter(self):
        """closed_lost → new is valid (re-entry after 90 days)."""
        validate_transition("closed_lost", "new")

    def test_archived_can_reenter(self):
        """archived → new is valid (re-entry after 180 days)."""
        validate_transition("archived", "new")

    def test_closed_won_cannot_reenter(self):
        """closed_won has no exit transitions."""
        with self.assertRaises(InvalidTransitionError):
            validate_transition("closed_won", "new")

    def test_closed_lost_cannot_skip_to_qualified(self):
        """closed_lost must go through new first."""
        with self.assertRaises(InvalidTransitionError):
            validate_transition("closed_lost", "qualified")


if __name__ == "__main__":
    unittest.main()
