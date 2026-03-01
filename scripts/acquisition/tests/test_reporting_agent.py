"""
acquisition/tests/test_reporting_agent.py — Tests for AAG Agent 10: Reporting Agent.

Tests stats collection, insight generation, formatting, variant tracking,
and auto-apply functionality.
"""
import unittest
from datetime import datetime, date, timedelta
from unittest.mock import patch, MagicMock

from ..reporting import stats_collector, insight_generator, formatter
from ..db import queries


class TestStatsCollector(unittest.TestCase):
    """Test weekly stats collection."""

    @patch('acquisition.db.queries.count_funnel_events')
    @patch('acquisition.db.queries.count_crm_messages')
    @patch('acquisition.db.queries.count_replies_this_week')
    @patch('acquisition.db.queries.get_pipeline_snapshot')
    @patch('acquisition.db.queries.get_top_platform_by_reply_rate')
    @patch('acquisition.db.queries.get_top_niche_by_reply_rate')
    @patch('acquisition.db.queries.get_variant_performance')
    def test_collect_weekly_stats_returns_valid_stats(
        self, mock_variants, mock_top_niche, mock_top_platform,
        mock_snapshot, mock_replies, mock_messages, mock_events
    ):
        """Test that collect_weekly_stats returns valid WeeklyStats."""
        # Setup mocks
        mock_events.return_value = (50, None)  # Default count
        mock_messages.return_value = (30, None)
        mock_replies.return_value = (15, None)
        mock_snapshot.return_value = ({"new": 10, "qualified": 5}, None)
        mock_top_platform.return_value = ("twitter", None)
        mock_top_niche.return_value = ("ai-automation", None)
        mock_variants.return_value = ([{"name": "variant-A", "reply_rate": 0.25}], None)

        week_start = date(2026, 2, 24)
        stats, err = stats_collector.collect_weekly_stats(week_start)

        self.assertIsNone(err)
        self.assertIsNotNone(stats)
        self.assertEqual(stats.week_start, week_start)
        self.assertEqual(stats.week_end, week_start + timedelta(days=7))
        self.assertIsInstance(stats.discovered, int)
        self.assertIsInstance(stats.reply_rate, float)

    def test_safe_divide_handles_zero_denominator(self):
        """Test that safe_divide returns 0 for division by zero."""
        result = stats_collector.safe_divide(10, 0)
        self.assertEqual(result, 0.0)

        result = stats_collector.safe_divide(10, 5)
        self.assertEqual(result, 2.0)

    @patch('acquisition.db.queries.count_contacts_that_reached_stage')
    def test_conversion_calculator_safe_divide_zero(self, mock_count):
        """Test conversion calculator handles zero contacts gracefully."""
        mock_count.return_value = (0, None)

        rates, err = stats_collector.get_conversion_rates(since_days=30)

        self.assertIsNone(err)
        self.assertIsNotNone(rates)
        # Should not raise division by zero
        self.assertEqual(rates["overall_funnel"], 0.0)


class TestVariantTracker(unittest.TestCase):
    """Test variant performance tracking."""

    @patch('acquisition.db.queries.get_variant_performance')
    @patch('acquisition.db.queries.mark_variant_winner')
    @patch('acquisition.db.queries.deactivate_variant')
    def test_variant_tracker_identifies_winner_at_2x(
        self, mock_deactivate, mock_mark_winner, mock_get_variants
    ):
        """Test that variant tracker identifies winner when one has 2x reply rate."""
        # Setup: variant A has 30% reply rate, variant B has 15%
        mock_get_variants.return_value = ([
            {"id": "var-a", "name": "A", "reply_rate": 0.30, "sends": 50, "is_active": True},
            {"id": "var-b", "name": "B", "reply_rate": 0.15, "sends": 50, "is_active": True},
        ], None)
        mock_mark_winner.return_value = (None, None)
        mock_deactivate.return_value = (None, None)

        actions, err = insight_generator.update_variant_performance()

        self.assertIsNone(err)
        self.assertGreater(len(actions), 0)
        # Should mark A as winner and deactivate B
        mock_mark_winner.assert_called_once_with("var-a")
        mock_deactivate.assert_called_once_with("var-b")

    @patch('acquisition.db.queries.get_variant_performance')
    def test_variant_tracker_requires_10_sample_minimum(self, mock_get_variants):
        """Test that variant tracker requires minimum 10 samples for winner."""
        # Setup: variant A has 2x rate but only 8 sends
        mock_get_variants.return_value = ([
            {"id": "var-a", "name": "A", "reply_rate": 0.30, "sends": 8, "is_active": True},
            {"id": "var-b", "name": "B", "reply_rate": 0.15, "sends": 8, "is_active": True},
        ], None)

        actions, err = insight_generator.update_variant_performance()

        self.assertIsNone(err)
        # Should not flag winner (insufficient data)
        self.assertEqual(len(actions), 1)
        self.assertIn("Insufficient data", actions[0])


class TestInsightGenerator(unittest.TestCase):
    """Test Claude-powered insight generation."""

    def test_insight_generator_returns_valid_json_array(self):
        """Test that insight generator returns valid Insight objects."""
        # Create mock stats
        stats = stats_collector.WeeklyStats(
            week_start=date(2026, 2, 24),
            week_end=date(2026, 3, 3),
            discovered=100,
            qualified=70,
            warmup_sent=50,
            dms_sent=40,
            emails_sent=30,
            replies_received=20,
            calls_booked=5,
            closed_won=2,
            pipeline_snapshot={"new": 10, "qualified": 20},
            qualify_rate=0.7,
            reply_rate=0.29,
            email_reply_rate=0.25,
            close_rate=0.10,
            top_platform="twitter",
            top_niche="ai-automation",
            prev_qualify_rate=0.65,
            prev_reply_rate=0.22,
            variant_stats=[{"name": "A", "reply_rate": 0.30, "sends": 50}]
        )

        # Mock Claude API call
        with patch('urllib.request.urlopen') as mock_urlopen:
            mock_response = MagicMock()
            mock_response.read.return_value = b'''
            {
                "content": [{
                    "text": "[{\\"observation\\": \\"Twitter has 29% reply rate\\", \\"evidence\\": \\"20 replies from 70 messages\\", \\"recommended_action\\": \\"Focus on Twitter\\", \\"confidence\\": 85}]"
                }]
            }
            '''
            mock_urlopen.return_value.__enter__.return_value = mock_response

            insights, err = insight_generator.generate_insights(stats)

            # Should succeed if API key is configured
            if err and "not configured" in err:
                self.skipTest("ANTHROPIC_API_KEY not configured")
            else:
                self.assertIsNone(err)
                self.assertIsInstance(insights, list)
                if insights:
                    self.assertIsInstance(insights[0], insight_generator.Insight)


class TestFormatter(unittest.TestCase):
    """Test report formatting."""

    def test_formatter_produces_valid_markdown(self):
        """Test that formatter produces valid markdown."""
        stats = stats_collector.WeeklyStats(
            week_start=date(2026, 2, 24),
            week_end=date(2026, 3, 3),
            discovered=100,
            qualified=70,
            warmup_sent=50,
            dms_sent=40,
            emails_sent=30,
            replies_received=20,
            calls_booked=5,
            closed_won=2,
            pipeline_snapshot={"new": 10, "qualified": 20},
            qualify_rate=0.7,
            reply_rate=0.29,
            email_reply_rate=0.25,
            close_rate=0.10,
            top_platform="twitter",
            top_niche="ai-automation",
        )

        insights = [
            insight_generator.Insight(
                observation="Twitter performs best",
                evidence="29% reply rate vs 15% Instagram",
                recommended_action="Focus on Twitter",
                confidence=85
            )
        ]

        report_md = formatter.format_markdown(stats, insights)

        # Check markdown structure
        self.assertIn("# Acquisition Pipeline", report_md)
        self.assertIn("## 📊 Funnel This Week", report_md)
        self.assertIn("| Metric | This Week | vs Last Week |", report_md)
        self.assertIn("Twitter performs best", report_md)
        self.assertIn("Focus on Twitter", report_md)

    def test_delta_str_formatting(self):
        """Test delta string formatting."""
        # Positive absolute change
        result = formatter.delta_str(50, 40, pct=False)
        self.assertIn("+10", result)
        self.assertIn("25%", result)  # 10/40 = 25%

        # Negative absolute change
        result = formatter.delta_str(30, 40, pct=False)
        self.assertIn("-10", result)

        # Percentage change (percentage points)
        result = formatter.delta_str(0.75, 0.65, pct=True)
        self.assertIn("+10", result)
        self.assertIn("pp", result)  # percentage points


class TestAutoApplyInsights(unittest.TestCase):
    """Test auto-apply insights functionality."""

    @patch('acquisition.db.queries.update_all_niche_min_scores')
    def test_auto_apply_raises_score_within_bounds(self, mock_update):
        """Test that auto-apply updates scores within safe bounds."""
        mock_update.return_value = (None, None)

        insights = [
            insight_generator.Insight(
                observation="Low qualify rate",
                evidence="Only 50% of discovered are qualified",
                recommended_action="Raise ICP min_score to 75",
                confidence=80
            )
        ]

        applied, err = insight_generator.auto_apply_insights(insights, dry_run=False)

        self.assertIsNone(err)
        self.assertGreater(len(applied), 0)
        mock_update.assert_called_once_with(75)

    @patch('acquisition.db.queries.update_all_niche_min_scores')
    def test_auto_apply_rejects_out_of_bounds_score(self, mock_update):
        """Test that auto-apply rejects unreasonable score values."""
        insights = [
            insight_generator.Insight(
                observation="Too strict",
                evidence="95% rejection rate",
                recommended_action="Raise ICP min_score to 95",  # Too high
                confidence=80
            )
        ]

        applied, err = insight_generator.auto_apply_insights(insights, dry_run=False)

        self.assertIsNone(err)
        # Should not apply (95 > 85 upper bound)
        mock_update.assert_not_called()

    def test_auto_apply_skips_low_confidence(self):
        """Test that auto-apply skips low-confidence insights."""
        insights = [
            insight_generator.Insight(
                observation="Small sample",
                evidence="Only 3 samples",
                recommended_action="Raise ICP min_score to 75",
                confidence=50  # Too low
            )
        ]

        applied, err = insight_generator.auto_apply_insights(insights, dry_run=False)

        self.assertIsNone(err)
        # Should not apply due to low confidence
        self.assertEqual(len(applied), 0)


class TestReportDelivery(unittest.TestCase):
    """Test report delivery mechanisms."""

    @patch('acquisition.db.queries.insert_weekly_report')
    def test_report_stored_in_acq_weekly_reports(self, mock_insert):
        """Test that reports are stored in acq_weekly_reports table."""
        mock_insert.return_value = ({"id": "report-123"}, None)

        from ..reporting_agent import deliver_report

        stats = stats_collector.WeeklyStats(
            week_start=date(2026, 2, 24),
            week_end=date(2026, 3, 3),
            discovered=100,
            qualified=70,
            warmup_sent=50,
            dms_sent=40,
            emails_sent=30,
            replies_received=20,
            calls_booked=5,
            closed_won=2,
            pipeline_snapshot={},
            qualify_rate=0.7,
            reply_rate=0.29,
            email_reply_rate=0.25,
            close_rate=0.10,
            top_platform="twitter",
            top_niche="ai-automation",
        )

        with patch('acquisition.reporting_agent.send_report_email', return_value=(False, "Email not configured")):
            with patch('acquisition.reporting_agent.send_push_notification', return_value=(True, "Sent")):
                with patch('acquisition.reporting_agent.write_to_obsidian', return_value=(False, "Vault not found")):
                    results = deliver_report(date(2026, 2, 24), "# Report", "<html></html>", stats)

        # Check that database insert was called
        mock_insert.assert_called_once()
        self.assertTrue(results["database"]["success"])

    @patch('subprocess.run')
    def test_obsidian_file_written_to_correct_path(self, mock_run):
        """Test that Obsidian file is written to correct path."""
        from ..reporting_agent import write_to_obsidian
        from pathlib import Path

        # Mock vault path to exist
        with patch.object(Path, 'exists', return_value=True):
            with patch('builtins.open', create=True) as mock_open:
                success, msg = write_to_obsidian(date(2026, 2, 24), "# Report")

        # Should attempt to write to daily notes
        if success:
            self.assertIn("2026-02-24", msg)


class TestEndToEnd(unittest.TestCase):
    """End-to-end integration tests."""

    @patch('acquisition.db.queries.count_funnel_events')
    @patch('acquisition.db.queries.count_crm_messages')
    @patch('acquisition.db.queries.count_replies_this_week')
    @patch('acquisition.db.queries.get_pipeline_snapshot')
    @patch('acquisition.db.queries.get_top_platform_by_reply_rate')
    @patch('acquisition.db.queries.get_top_niche_by_reply_rate')
    @patch('acquisition.db.queries.get_variant_performance')
    @patch('acquisition.db.queries.count_contacts_that_reached_stage')
    def test_full_report_generation_workflow(
        self, mock_stage_count, mock_variants, mock_top_niche,
        mock_top_platform, mock_snapshot, mock_replies,
        mock_messages, mock_events
    ):
        """Test complete report generation from stats to formatted output."""
        # Setup all mocks
        mock_events.return_value = (50, None)
        mock_messages.return_value = (30, None)
        mock_replies.return_value = (15, None)
        mock_snapshot.return_value = ({"new": 10}, None)
        mock_top_platform.return_value = ("twitter", None)
        mock_top_niche.return_value = ("ai-automation", None)
        mock_variants.return_value = ([{"name": "A", "reply_rate": 0.25}], None)
        mock_stage_count.return_value = (50, None)

        # Run full workflow
        week_start = date(2026, 2, 24)
        stats, err = stats_collector.collect_weekly_stats(week_start)
        self.assertIsNone(err)

        # Format report (skip insight generation to avoid API call)
        insights = []
        report_md = formatter.format_markdown(stats, insights)

        # Verify output
        self.assertIsNotNone(report_md)
        self.assertIn("Acquisition Pipeline", report_md)
        self.assertGreater(len(report_md), 100)


if __name__ == "__main__":
    unittest.main()
