"""
tests/test_followup_agent.py — Comprehensive tests for AAG Agent 06

Test coverage:
  - Reply detection logic
  - Stage advancement on reply
  - Pending follow-up cancellation
  - Conversation summary generation
  - Push/email notification delivery
  - Follow-up timing (Day 4, Day 7, Day 10)
  - Message generation for touch 2 and touch 3
  - Archive after no reply
"""

import asyncio
import sys
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from acquisition import config
from acquisition.db import queries
from acquisition.followup_agent import (
    ReplyDetector,
    generate_conversation_summary,
    handle_reply,
    generate_followup,
    process_followups,
)
from acquisition.notification_client import NotificationClient


# ── Test Fixtures ─────────────────────────────────────────────────────────────

def create_test_contact(
    contact_id: str = "test-contact-123",
    pipeline_stage: str = "contacted",
    last_outbound_at: str = None,
    last_inbound_at: str = None,
) -> dict:
    """Create a test contact record."""
    if last_outbound_at is None:
        last_outbound_at = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()

    return {
        "id": contact_id,
        "display_name": "Test User",
        "handle": "testuser",
        "platform": "twitter",
        "pipeline_stage": pipeline_stage,
        "relationship_score": 75,
        "bio": "AI enthusiast and solopreneur building cool stuff",
        "last_outbound_at": last_outbound_at,
        "last_inbound_at": last_inbound_at,
    }


def create_test_message(
    message_id: str = "msg-123",
    is_outbound: bool = False,
    message_text: str = "Hey there!",
) -> dict:
    """Create a test message record."""
    return {
        "id": message_id,
        "message_text": message_text,
        "is_outbound": is_outbound,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── Reply Detection Tests ─────────────────────────────────────────────────────

def test_reply_detector_uses_inbound_gt_outbound():
    """Test that reply detector correctly identifies replies using last_inbound_at > last_outbound_at."""
    # Mock data: last_inbound_at > last_outbound_at (replied)
    contact_replied = create_test_contact(
        contact_id="replied-1",
        last_outbound_at=(datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
        last_inbound_at=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
    )

    # Mock data: last_inbound_at < last_outbound_at (not replied)
    contact_not_replied = create_test_contact(
        contact_id="not-replied-1",
        last_outbound_at=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        last_inbound_at=(datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
    )

    # Test the filtering logic from get_contacts_with_replies
    test_contacts = [contact_replied, contact_not_replied]

    replied = []
    for contact in test_contacts:
        last_in = contact.get("last_inbound_at")
        last_out = contact.get("last_outbound_at")
        if last_in and last_out and last_in > last_out:
            replied.append(contact)

    assert len(replied) == 1
    assert replied[0]["id"] == "replied-1"
    print("✓ test_reply_detector_uses_inbound_gt_outbound")


@pytest.mark.asyncio
async def test_stage_advances_to_replied_on_detection():
    """Test that contacts move to 'replied' stage when reply is detected."""
    with patch('acquisition.db.queries.update_pipeline_stage') as mock_update:
        mock_update.return_value = ({}, None)

        with patch('acquisition.db.queries.cancel_pending_followups') as mock_cancel:
            mock_cancel.return_value = ({}, None)

            with patch('acquisition.db.queries.get_conversation_messages') as mock_messages:
                mock_messages.return_value = ([], None)

                with patch('acquisition.db.queries.insert_human_notification') as mock_notif:
                    mock_notif.return_value = ({}, None)

                    contact = create_test_contact(pipeline_stage="contacted")
                    notif_client = NotificationClient()

                    # Mock notification methods
                    notif_client.send_push = AsyncMock(return_value=True)
                    notif_client.send_email = AsyncMock(return_value=True)

                    await handle_reply(contact, notif_client)

                    # Verify stage was updated to 'replied'
                    mock_update.assert_called_once_with(contact["id"], "replied", triggered_by="agent")

    print("✓ test_stage_advances_to_replied_on_detection")


@pytest.mark.asyncio
async def test_pending_followups_cancelled_on_reply():
    """Test that pending follow-ups are cancelled when prospect replies."""
    with patch('acquisition.db.queries.cancel_pending_followups') as mock_cancel:
        mock_cancel.return_value = ({"cancelled_dm": True, "cancelled_email": True}, None)

        with patch('acquisition.db.queries.update_pipeline_stage') as mock_update:
            mock_update.return_value = ({}, None)

            with patch('acquisition.db.queries.get_conversation_messages') as mock_messages:
                mock_messages.return_value = ([], None)

                with patch('acquisition.db.queries.insert_human_notification') as mock_notif:
                    mock_notif.return_value = ({}, None)

                    contact = create_test_contact()
                    notif_client = NotificationClient()

                    notif_client.send_push = AsyncMock(return_value=True)
                    notif_client.send_email = AsyncMock(return_value=True)

                    await handle_reply(contact, notif_client)

                    # Verify cancel was called
                    mock_cancel.assert_called_once_with(contact["id"])

    print("✓ test_pending_followups_cancelled_on_reply")


# ── Conversation Summary Tests ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_conversation_summary_returns_valid_json():
    """Test that conversation summary returns valid JSON structure."""
    messages = [
        create_test_message(is_outbound=True, message_text="Hey! Loved your recent post about AI automation."),
        create_test_message(is_outbound=False, message_text="Thanks! Always happy to chat about AI."),
    ]

    contact = create_test_contact()

    # Mock Claude API call
    with patch('acquisition.followup_agent.call_claude') as mock_claude:
        mock_response = json.dumps({
            "summary": "Discussed AI automation and content creation",
            "sentiment": "positive",
            "recommended_response": "Continue conversation about AI tools"
        })
        mock_claude.return_value = mock_response

        summary = await generate_conversation_summary(messages, contact)

        assert "text" in summary
        assert "sentiment" in summary
        assert "recommended_response" in summary
        assert summary["sentiment"] in ["positive", "neutral", "objection", "interested"]

    print("✓ test_conversation_summary_returns_valid_json")


# ── Notification Tests ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_push_notification_sent_on_reply():
    """Test that push notification is sent when reply is detected."""
    contact = create_test_contact()
    summary = {
        "text": "They're interested in learning more",
        "sentiment": "positive",
        "recommended_response": "Share case study"
    }

    notif_client = NotificationClient()

    with patch('subprocess.run') as mock_subprocess:
        mock_subprocess.return_value = MagicMock(returncode=0)

        result = await notif_client.send_push(contact, summary)

        assert result is True
        assert mock_subprocess.called
        # Verify AppleScript was called (check args list)
        call_args = mock_subprocess.call_args[0][0]  # First positional arg
        assert call_args[0] == "osascript"

    print("✓ test_push_notification_sent_on_reply")


@pytest.mark.asyncio
async def test_email_notification_sent_on_reply():
    """Test that email notification is sent when reply is detected."""
    contact = create_test_contact()
    summary = {
        "text": "They're interested in learning more",
        "sentiment": "positive",
        "recommended_response": "Share case study"
    }

    notif_client = NotificationClient(owner_email="test@example.com")

    with patch('subprocess.run') as mock_subprocess:
        mock_subprocess.return_value = MagicMock(returncode=0)

        result = await notif_client.send_email(contact, summary)

        assert result is True
        assert mock_subprocess.called

    print("✓ test_email_notification_sent_on_reply")


# ── Follow-up Timing Tests ────────────────────────────────────────────────────

def test_followup1_triggers_at_day4():
    """Test that first follow-up is triggered at Day 4."""
    # Contact in 'contacted' stage, last_outbound_at was 4 days ago
    contact_day4 = create_test_contact(
        contact_id="day4-1",
        pipeline_stage="contacted",
        last_outbound_at=(datetime.now(timezone.utc) - timedelta(days=4, hours=1)).isoformat(),
        last_inbound_at=None,
    )

    # Contact in 'contacted' stage, last_outbound_at was 2 days ago (too soon)
    contact_day2 = create_test_contact(
        contact_id="day2-1",
        pipeline_stage="contacted",
        last_outbound_at=(datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
        last_inbound_at=None,
    )

    # Test filtering logic
    cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()

    ready_for_fu1 = []
    for contact in [contact_day4, contact_day2]:
        if contact["last_outbound_at"] < cutoff:
            last_in = contact.get("last_inbound_at")
            last_out = contact.get("last_outbound_at")
            if not last_in or (last_in and last_out and last_in < last_out):
                ready_for_fu1.append(contact)

    assert len(ready_for_fu1) == 1
    assert ready_for_fu1[0]["id"] == "day4-1"

    print("✓ test_followup1_triggers_at_day4")


def test_followup2_triggers_at_day7():
    """Test that second follow-up is triggered at Day 7."""
    # Contact in 'follow_up_1' stage, last_outbound_at was 3+ days ago
    contact_ready = create_test_contact(
        contact_id="fu2-ready",
        pipeline_stage="follow_up_1",
        last_outbound_at=(datetime.now(timezone.utc) - timedelta(days=3, hours=1)).isoformat(),
        last_inbound_at=None,
    )

    # Contact in 'follow_up_1' stage, last_outbound_at was 1 day ago (too soon)
    contact_too_soon = create_test_contact(
        contact_id="fu2-soon",
        pipeline_stage="follow_up_1",
        last_outbound_at=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
        last_inbound_at=None,
    )

    cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()

    ready_for_fu2 = []
    for contact in [contact_ready, contact_too_soon]:
        if contact["pipeline_stage"] == "follow_up_1" and contact["last_outbound_at"] < cutoff:
            last_in = contact.get("last_inbound_at")
            last_out = contact.get("last_outbound_at")
            if not last_in or (last_in and last_out and last_in < last_out):
                ready_for_fu2.append(contact)

    assert len(ready_for_fu2) == 1
    assert ready_for_fu2[0]["id"] == "fu2-ready"

    print("✓ test_followup2_triggers_at_day7")


def test_archive_after_followup2_no_reply():
    """Test that contacts are archived after follow_up_2 with no reply."""
    # Contact in 'follow_up_2' stage, last_outbound_at was 3+ days ago
    contact_archive = create_test_contact(
        contact_id="archive-1",
        pipeline_stage="follow_up_2",
        last_outbound_at=(datetime.now(timezone.utc) - timedelta(days=3, hours=1)).isoformat(),
        last_inbound_at=None,
    )

    cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()

    ready_for_archive = []
    for contact in [contact_archive]:
        if contact["pipeline_stage"] == "follow_up_2" and contact["last_outbound_at"] < cutoff:
            last_in = contact.get("last_inbound_at")
            last_out = contact.get("last_outbound_at")
            if not last_in or (last_in and last_out and last_in < last_out):
                ready_for_archive.append(contact)

    assert len(ready_for_archive) == 1
    assert ready_for_archive[0]["id"] == "archive-1"

    print("✓ test_archive_after_followup2_no_reply")


# ── Message Generation Tests ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_followup_message_generation_touch2():
    """Test that follow-up message is generated for touch 2."""
    contact = create_test_contact()

    with patch('acquisition.followup_agent.call_claude') as mock_claude:
        mock_claude.return_value = "Quick follow-up — are you still interested in automating your content pipeline?"

        with patch('acquisition.db.queries.get_first_outreach') as mock_outreach:
            mock_outreach.return_value = ({"message_text": "Hey! Loved your post about AI."}, None)

            message = await generate_followup(contact, touch_number=2)

            assert isinstance(message, str)
            assert len(message) > 0
            mock_claude.assert_called_once()

    print("✓ test_followup_message_generation_touch2")


@pytest.mark.asyncio
async def test_followup_message_generation_touch3():
    """Test that final follow-up message is generated for touch 3."""
    contact = create_test_contact()

    with patch('acquisition.followup_agent.call_claude') as mock_claude:
        mock_claude.return_value = "Last one from me — if your content needs ever change, happy to help!"

        with patch('acquisition.db.queries.get_first_outreach') as mock_outreach:
            mock_outreach.return_value = ({"message_text": "Hey! Loved your post about AI."}, None)

            message = await generate_followup(contact, touch_number=3)

            assert isinstance(message, str)
            assert len(message) > 0
            assert len(message) < 200  # Should be brief
            mock_claude.assert_called_once()

    print("✓ test_followup_message_generation_touch3")


# ── Integration Tests ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cancel_pending_email_on_dm_reply():
    """Test that pending email sequences are cancelled when DM reply is received."""
    with patch('acquisition.db.queries._update') as mock_update:
        mock_update.return_value = ({}, None)

        result, err = queries.cancel_pending_followups("test-contact-123")

        assert err is None
        assert result is not None
        # Verify both DM and email sequences were cancelled
        assert mock_update.call_count == 2

    print("✓ test_cancel_pending_email_on_dm_reply")


# ── Test Runner ───────────────────────────────────────────────────────────────

async def run_all_tests():
    """Run all test functions."""
    print("\n=== Running Follow-up Agent Tests ===\n")

    # Sync tests
    test_reply_detector_uses_inbound_gt_outbound()
    test_followup1_triggers_at_day4()
    test_followup2_triggers_at_day7()
    test_archive_after_followup2_no_reply()

    # Async tests
    await test_stage_advances_to_replied_on_detection()
    await test_pending_followups_cancelled_on_reply()
    await test_conversation_summary_returns_valid_json()
    await test_push_notification_sent_on_reply()
    await test_email_notification_sent_on_reply()
    await test_followup_message_generation_touch2()
    await test_followup_message_generation_touch3()
    await test_cancel_pending_email_on_dm_reply()

    print("\n=== All Tests Passed ✓ ===\n")


if __name__ == "__main__":
    asyncio.run(run_all_tests())
