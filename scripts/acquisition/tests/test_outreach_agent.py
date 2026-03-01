"""
tests/test_outreach_agent.py — Tests for Agent 05: Outreach Agent

Tests all components:
- Context building
- Message generation
- Message validation
- DM sending (with mocks)
- Touch recording
- Daily cap enforcement
- Channel coordination
"""
import asyncio
import json
import unittest
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime, timezone
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from acquisition.outreach_agent import (
    OutreachAgent,
    ContextBuilder,
    DMGenerator,
    MessageValidator,
    DMSender,
    TouchRecorder,
    ContactBrief,
    PostData,
    ValidationResult,
    SendResult,
)
from acquisition.channel_coordinator import ChannelCoordinator


class TestMessageValidator(unittest.TestCase):
    """Test message validation logic."""

    def test_rejects_banned_phrases(self):
        """Validator should reject messages with banned phrases."""
        validator = MessageValidator()

        # Test "hope this finds you" - message without proper nouns to ensure it fails
        message = "hey there, hope this finds you well, great stuff"
        result = validator.validate(message, "twitter")
        self.assertFalse(result.passed)
        self.assertIn("banned:hope this finds you", result.errors)

    def test_rejects_too_long(self):
        """Validator should reject messages exceeding platform limits."""
        validator = MessageValidator()

        # Create a message longer than Twitter's 280 chars
        message = "x" * 300
        result = validator.validate(message, "twitter")
        self.assertFalse(result.passed)
        self.assertTrue(any("too_long" in e for e in result.errors))

    def test_accepts_good_message(self):
        """Validator should accept well-crafted messages."""
        validator = MessageValidator()

        message = 'Loved your post about AI automation for solopreneurs. Have you tried batching content with Claude? Happy to share what we\'re seeing work.'
        result = validator.validate(message, "twitter")
        self.assertTrue(result.passed)
        self.assertGreaterEqual(result.score, 6)

    def test_multiple_banned_phrases(self):
        """Validator should penalize multiple banned phrases."""
        validator = MessageValidator()

        message = "Hope this finds you well. I'm reaching out to pick your brain about a quick call."
        result = validator.validate(message, "linkedin")
        self.assertFalse(result.passed)
        # Should have multiple violations
        self.assertGreater(len(result.errors), 2)


class TestContextBuilder(unittest.TestCase):
    """Test context building for contacts."""

    @patch('acquisition.outreach_agent.ContextBuilder._get_top_posts', new_callable=AsyncMock)
    def test_build_context_includes_top_posts(self, mock_get_posts):
        """Context builder should fetch and include top posts."""
        # Mock posts
        mock_get_posts.return_value = [
            PostData(text="Great post about AI", likes=100, comments=20),
            PostData(text="Another amazing post", likes=80, comments=15),
        ]

        # Sample contact
        contact = {
            "id": "test_123",
            "display_name": "Jane Doe",
            "primary_platform": "twitter",
            "handle": "janedoe",
            "icp_score": 85,
            "score_reasoning": "Perfect ICP: solopreneur, AI tools, engaged audience",
            "niche": "AI automation",
            "follower_count": 5000,
        }

        # Build context
        async def run_test():
            builder = ContextBuilder()
            brief = await builder.build_context(contact, "ai-content-engine")

            self.assertEqual(brief.display_name, "Jane Doe")
            self.assertEqual(brief.score, 85)
            self.assertEqual(len(brief.top_posts), 2)
            self.assertEqual(brief.top_posts[0].text, "Great post about AI")

        asyncio.run(run_test())


class TestDMGenerator(unittest.TestCase):
    """Test DM generation using Claude."""

    @patch('urllib.request.urlopen')
    def test_generate_dm_calls_claude(self, mock_urlopen):
        """DM generator should call Claude API with proper prompt."""
        # Mock Claude API response
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            "content": [{"text": "Loved your post about \"AI automation.\" Have you tried batching? Would love to share what's working."}]
        }).encode()
        mock_urlopen.return_value.__enter__.return_value = mock_response

        # Sample brief
        brief = ContactBrief(
            contact_id="test_123",
            display_name="Jane Doe",
            platform="twitter",
            handle="janedoe",
            score=85,
            score_reasoning="Perfect ICP",
            top_posts=[PostData(text="AI automation is the future", likes=100, comments=20)],
            niche="AI automation",
            follower_count=5000,
            service_description="AI-powered content engine",
        )

        # Generate DM
        async def run_test():
            generator = DMGenerator()
            message = await generator.generate_dm(brief, "ai-content-engine")

            self.assertIsInstance(message, str)
            self.assertGreater(len(message), 10)
            # Verify Claude was called
            self.assertTrue(mock_urlopen.called)

        asyncio.run(run_test())


class TestDMSender(unittest.TestCase):
    """Test DM sending logic."""

    def test_dry_run_returns_success(self):
        """Dry run mode should return success without sending."""
        contact = {
            "id": "test_123",
            "display_name": "Jane Doe",
            "primary_platform": "twitter",
            "handle": "janedoe",
        }

        async def run_test():
            sender = DMSender()
            result = await sender.send_dm(contact, "Test message", dry_run=True)

            self.assertTrue(result.success)
            self.assertTrue(result.dry_run)

        asyncio.run(run_test())

    @patch('acquisition.db.queries.increment_daily_cap')
    @patch('urllib.request.urlopen')
    def test_send_standard_platform(self, mock_urlopen, mock_cap):
        """Should send via standard endpoint for non-LinkedIn platforms."""
        # Mock daily cap check
        mock_cap.return_value = (True, None)

        # Mock API response
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            "success": True,
            "messageId": "msg_123"
        }).encode()
        mock_urlopen.return_value.__enter__.return_value = mock_response

        contact = {
            "id": "test_123",
            "display_name": "Jane Doe",
            "primary_platform": "twitter",
            "handle": "janedoe",
        }

        async def run_test():
            sender = DMSender()
            result = await sender.send_dm(contact, "Test message", dry_run=False)

            self.assertTrue(result.success)
            self.assertEqual(result.platform_message_id, "msg_123")
            # Verify cap was checked
            mock_cap.assert_called_once_with("dm", "twitter")

        asyncio.run(run_test())

    @patch('acquisition.db.queries.increment_daily_cap')
    def test_daily_cap_blocks_send(self, mock_cap):
        """Should block send when daily cap is reached."""
        # Mock daily cap reached
        mock_cap.return_value = (False, None)

        contact = {
            "id": "test_123",
            "display_name": "Jane Doe",
            "primary_platform": "twitter",
            "handle": "janedoe",
        }

        async def run_test():
            sender = DMSender()
            result = await sender.send_dm(contact, "Test message", dry_run=False)

            self.assertFalse(result.success)
            self.assertIn("cap", result.error.lower())

        asyncio.run(run_test())

    @patch('acquisition.db.queries.increment_daily_cap')
    @patch('urllib.request.urlopen')
    def test_linkedin_uses_two_step(self, mock_urlopen, mock_cap):
        """LinkedIn should use 2-step flow: open + send."""
        # Mock daily cap check
        mock_cap.return_value = (True, None)

        # Mock open response
        open_response = Mock()
        open_response.read.return_value = json.dumps({"success": True}).encode()

        # Mock send response
        send_response = Mock()
        send_response.read.return_value = json.dumps({
            "success": True,
            "messageId": "linkedin_msg_123"
        }).encode()

        # Setup mock to return different responses
        mock_urlopen.return_value.__enter__.side_effect = [open_response, send_response]

        contact = {
            "id": "test_123",
            "display_name": "Jane Doe",
            "primary_platform": "linkedin",
            "handle": "janedoe",
        }

        async def run_test():
            sender = DMSender()
            result = await sender.send_dm(contact, "Test message", dry_run=False)

            self.assertTrue(result.success)
            # Verify urlopen was called twice (open + send)
            self.assertEqual(mock_urlopen.call_count, 2)

        asyncio.run(run_test())


class TestTouchRecorder(unittest.TestCase):
    """Test touch recording logic."""

    @patch('acquisition.db.queries.insert_crm_message')
    @patch('acquisition.db.queries.insert_outreach_sequence')
    @patch('acquisition.db.queries.update_pipeline_stage')
    @patch('acquisition.db.queries.update_last_outbound_at')
    def test_records_touch_in_all_tables(
        self, mock_update_outbound, mock_update_stage, mock_insert_seq, mock_insert_msg
    ):
        """Touch recorder should write to all relevant tables."""
        # Mock successful inserts
        mock_insert_msg.return_value = ([{"id": "msg_123"}], None)
        mock_insert_seq.return_value = ([{"id": "seq_123"}], None)
        mock_update_stage.return_value = (None, None)
        mock_update_outbound.return_value = (None, None)

        contact = {
            "id": "test_123",
            "display_name": "Jane Doe",
            "primary_platform": "twitter",
        }

        send_result = SendResult(success=True, platform_message_id="msg_123")

        async def run_test():
            recorder = TouchRecorder()
            await recorder.record_touch(
                contact,
                "Test message",
                send_result,
                "ai-content-engine",
                touch_number=1
            )

            # Verify crm_messages was inserted
            mock_insert_msg.assert_called_once()
            msg_args = mock_insert_msg.call_args[1]
            self.assertEqual(msg_args["contact_id"], "test_123")
            self.assertEqual(msg_args["message_type"], "dm")
            self.assertTrue(msg_args["is_outbound"])
            self.assertEqual(msg_args["message_text"], "Test message")

            # Verify outreach sequence was inserted
            mock_insert_seq.assert_called_once()
            seq_data = mock_insert_seq.call_args[0][0]
            self.assertEqual(seq_data["contact_id"], "test_123")
            self.assertEqual(seq_data["status"], "sent")
            self.assertEqual(seq_data["platform_message_id"], "msg_123")

            # Verify pipeline stage was updated
            mock_update_stage.assert_called_once_with("test_123", "contacted", "outreach_agent")

            # Verify last_outbound_at was updated
            mock_update_outbound.assert_called_once()
            self.assertEqual(mock_update_outbound.call_args[0][0], "test_123")

        asyncio.run(run_test())

    @patch('acquisition.db.queries.insert_crm_message')
    @patch('acquisition.db.queries.insert_outreach_sequence')
    @patch('acquisition.db.queries.update_pipeline_stage')
    @patch('acquisition.db.queries.update_last_outbound_at')
    def test_records_failed_touch(
        self, mock_update_outbound, mock_update_stage, mock_insert_seq, mock_insert_msg
    ):
        """Touch recorder should record failed sends with proper status."""
        mock_insert_msg.return_value = ([{"id": "msg_123"}], None)
        mock_insert_seq.return_value = ([{"id": "seq_123"}], None)
        mock_update_stage.return_value = (None, None)
        mock_update_outbound.return_value = (None, None)

        contact = {
            "id": "test_123",
            "display_name": "Jane Doe",
            "primary_platform": "twitter",
        }

        send_result = SendResult(success=False, error="API error")

        async def run_test():
            recorder = TouchRecorder()
            await recorder.record_touch(
                contact,
                "Test message",
                send_result,
                "ai-content-engine",
                touch_number=1
            )

            # Verify sequence was inserted with failed status
            seq_data = mock_insert_seq.call_args[0][0]
            self.assertEqual(seq_data["status"], "failed")

        asyncio.run(run_test())


class TestChannelCoordinator(unittest.TestCase):
    """Test channel coordination logic."""

    @patch('acquisition.db.queries._select')
    def test_blocks_email_during_dm(self, mock_select):
        """Channel coordinator should block email when DM is active."""
        # Mock active DM sequence
        mock_select.side_effect = [
            ([{"id": "dm_seq_123", "status": "sent"}], None),  # DM active
            ([], None),  # Email not active
        ]

        contact = {
            "id": "test_123",
            "primary_platform": "instagram",
            "pipeline_stage": "contacted",
        }

        coordinator = ChannelCoordinator()
        active_channel = coordinator.get_active_channel(contact)

        self.assertEqual(active_channel, "dm")

    @patch('acquisition.db.queries._select')
    def test_linkedin_with_email_prefers_email(self, mock_select):
        """LinkedIn contacts with email should prefer email channel."""
        # Mock no active sequences
        mock_select.side_effect = [
            ([], None),  # No DM
            ([{"id": "email_seq_123", "status": "sent"}], None),  # Email active
        ]

        contact = {
            "id": "test_123",
            "primary_platform": "linkedin",
            "email": "test@example.com",
            "pipeline_stage": "contacted",
        }

        coordinator = ChannelCoordinator()
        active_channel = coordinator.get_active_channel(contact)

        self.assertEqual(active_channel, "email")

    @patch('acquisition.db.queries._update')
    def test_pause_email_if_dm_replied(self, mock_update):
        """Should pause email sequences when DM gets a reply."""
        mock_update.return_value = ({"rows_affected": 1}, None)

        coordinator = ChannelCoordinator()
        result = coordinator.pause_email_if_dm_replied("test_123")

        self.assertTrue(result)
        # Verify email sequences were archived
        mock_update.assert_called_once()
        call_args = mock_update.call_args
        self.assertIn("acq_email_sequences", call_args[0])
        self.assertEqual(call_args[0][2]["status"], "archived")

    @patch('acquisition.db.queries._update')
    def test_cancel_dm_if_email_replied(self, mock_update):
        """Should cancel DM sequences when email gets a reply."""
        mock_update.return_value = ({"rows_affected": 1}, None)

        coordinator = ChannelCoordinator()
        result = coordinator.cancel_dm_if_email_replied("test_123")

        self.assertTrue(result)
        # Verify DM sequences were archived
        mock_update.assert_called_once()
        call_args = mock_update.call_args
        self.assertIn("acq_outreach_sequences", call_args[0])
        self.assertEqual(call_args[0][2]["status"], "archived")


class TestOutreachAgent(unittest.TestCase):
    """Integration tests for OutreachAgent."""

    @patch('acquisition.db.queries.get_ready_for_dm')
    def test_handles_no_contacts(self, mock_get_contacts):
        """Agent should handle gracefully when no contacts are ready."""
        mock_get_contacts.return_value = ([], None)

        async def run_test():
            agent = OutreachAgent()
            result = await agent.run(limit=10, dry_run=True)

            self.assertEqual(result.total_processed, 0)
            self.assertEqual(result.successful, 0)

        asyncio.run(run_test())

    @patch('acquisition.outreach_agent.ContextBuilder.build_context', new_callable=AsyncMock)
    @patch('acquisition.outreach_agent.DMGenerator.generate_dm', new_callable=AsyncMock)
    @patch('acquisition.outreach_agent.DMSender.send_dm', new_callable=AsyncMock)
    @patch('acquisition.outreach_agent.TouchRecorder.record_touch', new_callable=AsyncMock)
    @patch('acquisition.db.queries.get_ready_for_dm')
    def test_processes_contact_successfully(
        self,
        mock_get_contacts,
        mock_record,
        mock_send,
        mock_generate,
        mock_build_context,
    ):
        """Agent should process a contact end-to-end."""
        # Mock contacts
        mock_get_contacts.return_value = ([{
            "id": "test_123",
            "display_name": "Jane Doe",
            "primary_platform": "twitter",
            "handle": "janedoe",
            "icp_score": 85,
        }], None)

        # Mock context
        mock_build_context.return_value = ContactBrief(
            contact_id="test_123",
            display_name="Jane Doe",
            platform="twitter",
            handle="janedoe",
            score=85,
            score_reasoning="Perfect ICP",
            top_posts=[PostData(text="Great post", likes=100, comments=20)],
            niche="AI automation",
            follower_count=5000,
            service_description="AI content engine",
        )

        # Mock generation
        mock_generate.return_value = 'Loved your post about "AI automation." Have you tried batching? Would love to share what works.'

        # Mock send
        mock_send.return_value = SendResult(success=True, dry_run=True)

        # Mock record
        mock_record.return_value = None

        async def run_test():
            agent = OutreachAgent()
            result = await agent.run(limit=1, dry_run=True)

            self.assertEqual(result.total_processed, 1)
            self.assertEqual(result.successful, 1)
            self.assertEqual(result.failed, 0)

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()
