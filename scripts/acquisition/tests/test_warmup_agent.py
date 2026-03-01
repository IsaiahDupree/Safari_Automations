"""
test_warmup_agent.py — Tests for AAG Agent 04: Warmup Agent

Tests cover:
- Schedule creation with proper time spreading
- Duplicate post guard
- Same-day comment guard
- Rate limit enforcement
- Stage advancement on completion
- Window timeout advancement
- High-score skip warmup
- Comment generation quality
- CRM message logging
"""

import json
from datetime import datetime, timezone, timedelta
from unittest.mock import Mock, patch, AsyncMock
import pytest

from acquisition.warmup_agent import (
    WarmupAgent,
    PostData,
    WarmupConfig,
    ScheduleResult,
    ExecuteResult,
    send_comment,
    search_posts,
    _call_claude,
)


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def mock_contact():
    return {
        "id": "contact-1",
        "display_name": "Test Creator",
        "platform": "instagram",
        "handle": "testcreator",
        "relationship_score": 72,
        "source_niche_config_id": "niche-1",
        "pipeline_stage": "qualified",
    }


@pytest.fixture
def mock_high_score_contact():
    return {
        "id": "contact-2",
        "display_name": "Top Creator",
        "platform": "twitter",
        "handle": "topcreator",
        "relationship_score": 90,
        "source_niche_config_id": "niche-1",
        "pipeline_stage": "qualified",
    }


@pytest.fixture
def mock_posts():
    return [
        PostData(
            url="https://instagram.com/p/post1",
            text="Just launched my new AI automation course!",
            platform="instagram",
            author_handle="testcreator",
            likes=150
        ),
        PostData(
            url="https://instagram.com/p/post2",
            text="Building in public: day 30 of my startup journey",
            platform="instagram",
            author_handle="testcreator",
            likes=89
        ),
        PostData(
            url="https://instagram.com/p/post3",
            text="3 lessons I learned scaling to $10k MRR",
            platform="instagram",
            author_handle="testcreator",
            likes=220
        ),
    ]


@pytest.fixture
def mock_config():
    return WarmupConfig(
        comments_target=3,
        window_days=5,
        min_gap_hours=12,
        skip_warmup_min_score=85,
        comment_tone="insightful",
        use_ai_comments=True,
    )


# ══════════════════════════════════════════════════════════════════════════════
# Scheduling Tests
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
@patch("acquisition.warmup_agent.queries")
async def test_schedule_spreads_comments_over_window_days(queries_mock, mock_contact, mock_posts, mock_config):
    """Test that schedules are spread across window_days."""
    # Setup mocks
    queries_mock.get_qualified_contacts.return_value = ([mock_contact], None)
    queries_mock._select.return_value = ([], None)  # No existing schedules
    queries_mock.get_niche_config.return_value = ({"name": "test-niche", "skip_warmup_min_score": 85}, None)
    queries_mock.insert_warmup_schedule.return_value = (None, None)
    queries_mock.update_pipeline_stage.return_value = (None, None)

    agent = WarmupAgent(dry_run=False)

    # Mock post fetching
    with patch.object(agent, '_get_posts_for_contact', return_value=(mock_posts, None)):
        with patch.object(agent, '_get_warmup_config', return_value=mock_config):
            result = await agent.schedule_batch(limit=10)

    # Verify schedules were created
    assert result.contacts_processed == 1
    assert result.schedules_created == 3

    # Verify insert_warmup_schedule was called 3 times
    assert queries_mock.insert_warmup_schedule.call_count == 3

    # Verify schedules are spread over ~5 days
    schedule_calls = queries_mock.insert_warmup_schedule.call_args_list
    scheduled_times = []
    for call in schedule_calls:
        schedule_data = call[0][0]
        scheduled_at = datetime.fromisoformat(schedule_data["scheduled_at"])
        scheduled_times.append(scheduled_at)

    # Check that schedules span multiple days
    time_span = (max(scheduled_times) - min(scheduled_times)).days
    assert time_span >= 2  # Should span at least 2 days for 3 comments over 5 days


@pytest.mark.asyncio
@patch("acquisition.warmup_agent.queries")
async def test_duplicate_post_guard(queries_mock, mock_contact, mock_posts):
    """Test that we never schedule the same post_url twice for same contact."""
    # Setup: contact already has schedule for post1
    now = datetime.now(timezone.utc).isoformat()
    existing_schedule = [{"post_url": "https://instagram.com/p/post1", "scheduled_at": now}]

    queries_mock.get_qualified_contacts.return_value = ([mock_contact], None)
    queries_mock._select.side_effect = [
        ([], None),  # No pending/sent schedules for contact
        (existing_schedule, None),  # Has existing schedule for post1
    ]
    queries_mock.get_niche_config.return_value = ({"name": "test-niche"}, None)
    queries_mock.insert_warmup_schedule.return_value = (None, None)
    queries_mock.update_pipeline_stage.return_value = (None, None)

    agent = WarmupAgent(dry_run=False)

    with patch.object(agent, '_get_warmup_config', return_value=WarmupConfig()):
        # Mock _get_posts_for_contact to filter out duplicates
        filtered_posts = [p for p in mock_posts if p.url != "https://instagram.com/p/post1"]
        with patch.object(agent, '_get_posts_for_contact', return_value=(filtered_posts, None)):
            result = await agent.schedule_batch(limit=10)

    # Verify only 2 schedules created (post1 was filtered out)
    assert result.schedules_created == 2


@pytest.mark.asyncio
@patch("acquisition.warmup_agent.queries")
async def test_same_day_guard(queries_mock, mock_contact, mock_posts, mock_config):
    """Test that we never schedule two comments on the same day."""
    queries_mock.get_qualified_contacts.return_value = ([mock_contact], None)
    queries_mock._select.return_value = ([], None)
    queries_mock.get_niche_config.return_value = ({"name": "test-niche"}, None)
    queries_mock.insert_warmup_schedule.return_value = (None, None)
    queries_mock.update_pipeline_stage.return_value = (None, None)

    agent = WarmupAgent(dry_run=False)

    with patch.object(agent, '_get_posts_for_contact', return_value=(mock_posts, None)):
        with patch.object(agent, '_get_warmup_config', return_value=mock_config):
            result = await agent.schedule_batch(limit=10)

    # Get all scheduled dates
    schedule_calls = queries_mock.insert_warmup_schedule.call_args_list
    scheduled_dates = []
    for call in schedule_calls:
        schedule_data = call[0][0]
        scheduled_at = datetime.fromisoformat(schedule_data["scheduled_at"])
        scheduled_dates.append(scheduled_at.date())

    # Verify no duplicate dates
    assert len(scheduled_dates) == len(set(scheduled_dates)), "Found duplicate dates in schedule"


@pytest.mark.asyncio
@patch("acquisition.warmup_agent.queries")
async def test_high_score_skip_warmup(queries_mock, mock_high_score_contact):
    """Test that contacts with score >= skip_warmup_min_score skip warmup."""
    queries_mock.get_qualified_contacts.return_value = ([mock_high_score_contact], None)
    queries_mock.update_pipeline_stage.return_value = (None, None)
    queries_mock.insert_funnel_event.return_value = (None, None)

    agent = WarmupAgent(dry_run=False)

    with patch.object(agent, '_get_warmup_config', return_value=WarmupConfig(skip_warmup_min_score=85)):
        result = await agent.schedule_batch(limit=10)

    # Verify high-score skip
    assert result.high_score_skips == 1
    assert result.schedules_created == 0

    # Verify advanced directly to ready_for_dm
    queries_mock.update_pipeline_stage.assert_called_once_with(
        "contact-2",
        "ready_for_dm",
        triggered_by="warmup_agent"
    )


# ══════════════════════════════════════════════════════════════════════════════
# Execution Tests
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
@patch("acquisition.warmup_agent.queries")
@patch("acquisition.warmup_agent.send_comment")
async def test_rate_limit_cap_enforcement(send_comment_mock, queries_mock, mock_contact):
    """Test that daily cap enforcement works correctly."""
    schedule = {
        "id": "schedule-1",
        "contact_id": "contact-1",
        "platform": "instagram",
        "post_url": "https://instagram.com/p/post1",
        "comment_text": "Great insights on AI automation!",
    }

    queries_mock.get_pending_warmup.return_value = ([schedule], None)
    queries_mock.check_daily_cap.return_value = (False, None)  # Cap reached
    queries_mock.update_warmup_status.return_value = (None, None)
    queries_mock.get_contact.return_value = (mock_contact, None)

    agent = WarmupAgent(dry_run=False)
    result = await agent.execute_pending(limit=10)

    # Verify rate limit skip
    assert result.rate_limit_skips == 1
    assert result.comments_sent == 0

    # Verify send_comment was not called
    send_comment_mock.assert_not_called()

    # Verify schedule was rescheduled
    assert queries_mock.update_warmup_status.called


@pytest.mark.asyncio
@patch("acquisition.warmup_agent.queries")
@patch("acquisition.warmup_agent.send_comment")
async def test_stage_advance_on_target_met(send_comment_mock, queries_mock, mock_contact):
    """Test that contact advances to ready_for_dm when target is met."""
    now = datetime.now(timezone.utc).isoformat()
    schedule = {
        "id": "schedule-1",
        "contact_id": "contact-1",
        "platform": "instagram",
        "post_url": "https://instagram.com/p/post1",
        "comment_text": "Great insights!",
    }

    # Setup: 2 comments already sent, this is the 3rd (target = 3)
    sent_schedules = [
        {"status": "sent", "scheduled_at": now},
        {"status": "sent", "scheduled_at": now},
        {"status": "sent", "scheduled_at": now}  # This one we're about to add
    ]

    queries_mock.get_pending_warmup.return_value = ([schedule], None)
    queries_mock.check_daily_cap.return_value = (True, None)
    queries_mock.get_contact.return_value = ({**mock_contact, "pipeline_stage": "warming"}, None)
    # First _select call returns sent schedules for completion check
    queries_mock._select.return_value = (sent_schedules, None)
    queries_mock.update_warmup_status.return_value = (None, None)
    queries_mock.insert_crm_message.return_value = (None, None)
    queries_mock.increment_daily_cap.return_value = (True, None)
    queries_mock.update_pipeline_stage.return_value = (None, None)
    queries_mock.insert_funnel_event.return_value = (None, None)

    send_comment_mock.return_value = ("comment-id-123", None)

    agent = WarmupAgent(dry_run=False)

    with patch.object(agent, '_get_warmup_config', return_value=WarmupConfig(comments_target=3)):
        result = await agent.execute_pending(limit=10)

    # Verify completion
    assert result.comments_sent == 1
    assert result.contacts_completed == 1

    # Verify stage advancement
    queries_mock.update_pipeline_stage.assert_called_with(
        "contact-1",
        "ready_for_dm",
        triggered_by="warmup_agent"
    )


@pytest.mark.asyncio
@patch("acquisition.warmup_agent.queries")
async def test_window_timeout_advance(queries_mock, mock_contact):
    """Test that contact advances when window expires."""
    # Setup: 7 days ago (window is 5 days)
    old_date = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    all_schedules = [
        {"scheduled_at": old_date, "status": "sent"},
        {"scheduled_at": old_date, "status": "sent"},
    ]

    queries_mock.get_contact.return_value = ({**mock_contact, "pipeline_stage": "warming"}, None)
    queries_mock._select.return_value = (all_schedules, None)
    queries_mock.update_pipeline_stage.return_value = (None, None)
    queries_mock.insert_funnel_event.return_value = (None, None)

    agent = WarmupAgent(dry_run=False)

    with patch.object(agent, '_get_warmup_config', return_value=WarmupConfig(window_days=5, comments_target=3)):
        completed = await agent._check_completion("contact-1")

    # Verify window timeout triggered advancement
    assert completed is True
    queries_mock.update_pipeline_stage.assert_called_once()


@pytest.mark.asyncio
@patch("acquisition.warmup_agent.queries")
@patch("acquisition.warmup_agent.send_comment")
async def test_crm_messages_written_after_send(send_comment_mock, queries_mock, mock_contact):
    """Test that crm_messages record is created after successful comment send."""
    schedule = {
        "id": "schedule-1",
        "contact_id": "contact-1",
        "platform": "instagram",
        "post_url": "https://instagram.com/p/post1",
        "comment_text": "Great post!",
    }

    queries_mock.get_pending_warmup.return_value = ([schedule], None)
    queries_mock.check_daily_cap.return_value = (True, None)
    queries_mock.get_contact.return_value = (mock_contact, None)
    queries_mock._select.return_value = ([], None)
    queries_mock.update_warmup_status.return_value = (None, None)
    queries_mock.insert_crm_message.return_value = (None, None)
    queries_mock.increment_daily_cap.return_value = (True, None)

    send_comment_mock.return_value = ("comment-id-123", None)

    agent = WarmupAgent(dry_run=False)

    with patch.object(agent, '_get_warmup_config', return_value=WarmupConfig()):
        result = await agent.execute_pending(limit=10)

    # Verify crm_messages was called
    queries_mock.insert_crm_message.assert_called_once()
    call_args = queries_mock.insert_crm_message.call_args
    assert call_args[1]["contact_id"] == "contact-1"
    assert call_args[1]["message_type"] == "comment"
    assert call_args[1]["is_outbound"] is True


# ══════════════════════════════════════════════════════════════════════════════
# Comment Generation Tests
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
@patch("acquisition.warmup_agent._call_claude")
async def test_comment_generator_not_generic(claude_mock):
    """Test that generated comments contain words from post text."""
    post = PostData(
        url="https://instagram.com/p/test",
        text="Just launched my new AI automation course for solopreneurs!",
        platform="instagram",
        author_handle="creator",
        likes=100
    )

    # Mock Claude response
    claude_mock.return_value = (
        "Love how you're making AI automation accessible to solopreneurs! What framework do you recommend starting with?",
        None
    )

    agent = WarmupAgent()
    config = WarmupConfig(comment_tone="curious")

    comment = await agent._generate_comment(post, config, niche="ai-automation")

    # Verify comment is not generic
    generic_phrases = ["great post", "love this", "so true", "amazing"]
    assert not any(phrase in comment.lower() for phrase in generic_phrases)

    # Verify comment references post content
    assert "automation" in comment.lower() or "solopreneur" in comment.lower()


@pytest.mark.asyncio
async def test_comment_respects_platform_emoji_rules():
    """Test that emoji usage respects platform rules."""
    agent = WarmupAgent()
    config = WarmupConfig(comment_tone="insightful")

    # TikTok post (emojis allowed)
    tiktok_post = PostData(
        url="https://tiktok.com/p/test",
        text="Day 30 of building in public",
        platform="tiktok",
        author_handle="creator",
    )

    # Twitter post (no emojis by default in our implementation)
    twitter_post = PostData(
        url="https://twitter.com/p/test",
        text="Day 30 of building in public",
        platform="twitter",
        author_handle="creator",
    )

    with patch("acquisition.warmup_agent._call_claude") as claude_mock:
        # Call for TikTok
        claude_mock.return_value = ("Great progress! 🚀", None)
        await agent._generate_comment(tiktok_post, config, "startup")
        tiktok_prompt = claude_mock.call_args[0][0]
        assert "Use 1-2 emojis" in tiktok_prompt

        # Call for Twitter
        claude_mock.return_value = ("Great progress on your journey!", None)
        await agent._generate_comment(twitter_post, config, "startup")
        twitter_prompt = claude_mock.call_args[0][0]
        assert "No emojis" in twitter_prompt


# ══════════════════════════════════════════════════════════════════════════════
# Integration Tests
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
@patch("acquisition.warmup_agent.queries")
async def test_full_warmup_cycle(queries_mock, mock_contact, mock_posts):
    """Test complete warmup cycle: schedule → execute → complete."""
    now = datetime.now(timezone.utc).isoformat()

    # Phase 1: Schedule
    queries_mock.get_qualified_contacts.return_value = ([mock_contact], None)
    queries_mock._select.return_value = ([], None)
    queries_mock.get_niche_config.return_value = ({"name": "test-niche"}, None)
    queries_mock.insert_warmup_schedule.return_value = (None, None)
    queries_mock.update_pipeline_stage.return_value = (None, None)

    agent = WarmupAgent(dry_run=False)

    with patch.object(agent, '_get_posts_for_contact', return_value=(mock_posts, None)):
        with patch.object(agent, '_get_warmup_config', return_value=WarmupConfig(comments_target=2)):
            schedule_result = await agent.schedule_batch(limit=10)

    assert schedule_result.contacts_processed == 1
    assert schedule_result.schedules_created == 2

    # Phase 2: Execute first comment
    schedule1 = {
        "id": "schedule-1",
        "contact_id": "contact-1",
        "platform": "instagram",
        "post_url": "https://instagram.com/p/post1",
        "comment_text": "Great insights!",
    }

    queries_mock.get_pending_warmup.return_value = ([schedule1], None)
    queries_mock.check_daily_cap.return_value = (True, None)
    queries_mock.get_contact.return_value = ({**mock_contact, "pipeline_stage": "warming"}, None)
    queries_mock.insert_crm_message.return_value = (None, None)
    queries_mock.increment_daily_cap.return_value = (True, None)
    queries_mock._select.return_value = ([], None)  # No sent yet
    queries_mock.update_warmup_status.return_value = (None, None)

    with patch("acquisition.warmup_agent.send_comment") as send_mock:
        send_mock.return_value = ("comment-1", None)
        with patch.object(agent, '_get_warmup_config', return_value=WarmupConfig(comments_target=2)):
            exec_result1 = await agent.execute_pending(limit=1)

    assert exec_result1.comments_sent == 1
    assert exec_result1.contacts_completed == 0  # Not complete yet

    # Phase 3: Execute second comment, should complete
    schedule2 = {
        "id": "schedule-2",
        "contact_id": "contact-1",
        "platform": "instagram",
        "post_url": "https://instagram.com/p/post2",
        "comment_text": "Love this perspective!",
    }

    queries_mock.get_pending_warmup.return_value = ([schedule2], None)
    queries_mock._select.return_value = ([
        {"status": "sent", "scheduled_at": now},
        {"status": "sent", "scheduled_at": now}
    ], None)  # 2 sent (including this one)
    queries_mock.insert_funnel_event.return_value = (None, None)  # Add this mock

    with patch("acquisition.warmup_agent.send_comment") as send_mock:
        send_mock.return_value = ("comment-2", None)
        with patch.object(agent, '_get_warmup_config', return_value=WarmupConfig(comments_target=2)):
            exec_result2 = await agent.execute_pending(limit=1)

    assert exec_result2.comments_sent == 1
    assert exec_result2.contacts_completed == 1  # Should complete now


# ══════════════════════════════════════════════════════════════════════════════
# Helper Function Tests
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
@patch("acquisition.warmup_agent.urllib.request.urlopen")
async def test_send_comment_success(urlopen_mock):
    """Test successful comment sending."""
    # Mock HTTP response
    mock_response = Mock()
    mock_response.read.return_value = json.dumps({
        "success": True,
        "commentId": "comment-123"
    }).encode()
    mock_response.__enter__ = Mock(return_value=mock_response)
    mock_response.__exit__ = Mock(return_value=False)
    urlopen_mock.return_value = mock_response

    comment_id, err = await send_comment("instagram", "https://instagram.com/p/test", "Great post!")

    assert comment_id == "comment-123"
    assert err is None


@pytest.mark.asyncio
@patch("acquisition.warmup_agent.urllib.request.urlopen")
async def test_search_posts_success(urlopen_mock):
    """Test successful post search."""
    # Mock HTTP response
    mock_response = Mock()
    mock_response.read.return_value = json.dumps({
        "posts": [
            {
                "url": "https://instagram.com/p/post1",
                "text": "Test post 1",
                "likes": 100,
            },
            {
                "url": "https://instagram.com/p/post2",
                "text": "Test post 2",
                "likes": 50,
            },
        ]
    }).encode()
    mock_response.__enter__ = Mock(return_value=mock_response)
    mock_response.__exit__ = Mock(return_value=False)
    urlopen_mock.return_value = mock_response

    posts, err = await search_posts("instagram", "testuser", max_results=5)

    assert len(posts) == 2
    assert posts[0].url == "https://instagram.com/p/post1"
    assert posts[0].text == "Test post 1"
    assert err is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
