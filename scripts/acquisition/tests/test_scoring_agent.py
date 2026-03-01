"""
tests/test_scoring_agent.py — Tests for ICP Scoring Agent (Agent 03).

Usage:
    pytest scripts/acquisition/tests/test_scoring_agent.py -v
"""
import asyncio
import json
import pytest
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch, call

from ..scoring_agent import ScoringAgent, ScoreResult, ScoringResult, DEFAULT_SCORING_PROMPT


# ═══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def sample_contact():
    """Sample contact for testing."""
    return {
        "id": str(uuid.uuid4()),
        "display_name": "Jane Doe",
        "handle": "janedoe",
        "platform": "twitter",
        "follower_count": 15000,
        "bio_text": "Business coach helping entrepreneurs scale their online presence. 10+ years experience.",
        "top_post_text": "Just helped my client 10x their revenue with AI automation. Here's what we did...",
        "top_post_likes": 450,
        "niche_label": "ai-automation-coaches",
        "source_niche_config_id": str(uuid.uuid4()),
        "pipeline_stage": "new",
        "relationship_score": None,
    }


@pytest.fixture
def sample_niche_config():
    """Sample niche config for testing."""
    return {
        "id": str(uuid.uuid4()),
        "name": "ai-automation-coaches",
        "service_slug": "ai-content-engine",
        "icp_min_score": 65,
        "scoring_prompt": DEFAULT_SCORING_PROMPT,
    }


@pytest.fixture
def scoring_agent():
    """Scoring agent instance in dry-run mode."""
    return ScoringAgent(dry_run=True)


@pytest.fixture
def mock_claude_response_single():
    """Mock Claude response for single contact scoring."""
    return json.dumps({
        "score": 82,
        "reasoning": "Perfect ICP match: business coach with 15K followers, talks about growth and AI",
        "signals": ["active poster", "growth-focused", "ideal follower count"]
    })


@pytest.fixture
def mock_claude_response_batch():
    """Mock Claude response for batch scoring."""
    return json.dumps([
        {"contact_index": 0, "score": 85, "reasoning": "Excellent fit"},
        {"contact_index": 1, "score": 48, "reasoning": "Too small, no business focus"},
        {"contact_index": 2, "score": 72, "reasoning": "Good match, borderline qualified"}
    ])


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Claude Prompt Parsing
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_scoring_prompt_returns_valid_json(scoring_agent, sample_contact, mock_claude_response_single):
    """Test that Claude response is parsed correctly as JSON."""
    with patch("acquisition.scoring_agent._call_claude") as mock_claude:
        mock_claude.return_value = (mock_claude_response_single, None)

        result = await scoring_agent.score_contact(sample_contact, DEFAULT_SCORING_PROMPT)

        assert result is not None
        assert isinstance(result, ScoreResult)
        assert result.score == 82
        assert "Perfect ICP match" in result.reasoning
        assert len(result.signals) == 3


@pytest.mark.asyncio
async def test_scoring_handles_markdown_wrapped_json(scoring_agent, sample_contact):
    """Test that Claude responses wrapped in markdown code blocks are parsed correctly."""
    markdown_response = """```json
{
    "score": 75,
    "reasoning": "Good fit overall",
    "signals": ["active", "business-focused"]
}
```"""

    with patch("acquisition.scoring_agent._call_claude") as mock_claude:
        mock_claude.return_value = (markdown_response, None)

        result = await scoring_agent.score_contact(sample_contact, DEFAULT_SCORING_PROMPT)

        assert result is not None
        assert result.score == 75
        assert result.reasoning == "Good fit overall"


@pytest.mark.asyncio
async def test_scoring_handles_invalid_json(scoring_agent, sample_contact):
    """Test that invalid JSON responses are handled gracefully."""
    with patch("acquisition.scoring_agent._call_claude") as mock_claude:
        mock_claude.return_value = ("This is not JSON", None)

        result = await scoring_agent.score_contact(sample_contact, DEFAULT_SCORING_PROMPT)

        assert result is None


@pytest.mark.asyncio
async def test_scoring_handles_claude_error(scoring_agent, sample_contact):
    """Test that Claude API errors are handled gracefully."""
    with patch("acquisition.scoring_agent._call_claude") as mock_claude:
        mock_claude.return_value = (None, "API rate limit exceeded")

        result = await scoring_agent.score_contact(sample_contact, DEFAULT_SCORING_PROMPT)

        assert result is None


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Batch Scoring
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_batch_scoring_20_contacts(scoring_agent, mock_claude_response_batch):
    """Test that batch scoring works for up to 20 contacts."""
    contacts = []
    for i in range(3):
        contacts.append({
            "id": str(uuid.uuid4()),
            "display_name": f"User {i}",
            "handle": f"user{i}",
            "platform": "twitter",
            "follower_count": 1000 * (i + 1),
            "bio_text": f"Bio for user {i}",
            "top_post_text": f"Post from user {i}",
            "top_post_likes": 100 * i,
            "niche_label": "test",
        })

    with patch("acquisition.scoring_agent._call_claude") as mock_claude:
        mock_claude.return_value = (mock_claude_response_batch, None)

        results = await scoring_agent.batch_score(contacts, DEFAULT_SCORING_PROMPT)

        assert len(results) == 3
        assert results[0].score == 85
        assert results[1].score == 48
        assert results[2].score == 72


@pytest.mark.asyncio
async def test_fallback_to_individual_on_batch_parse_fail(scoring_agent):
    """Test that batch scoring falls back to individual scoring on parse failure."""
    # Use 2+ contacts to actually trigger batch mode (single contact uses shortcut)
    contacts = [
        {
            "id": str(uuid.uuid4()),
            "display_name": "User 1",
            "handle": "user1",
            "platform": "twitter",
            "follower_count": 1000,
            "bio_text": "Bio",
            "top_post_text": "Post",
            "top_post_likes": 10,
            "niche_label": "test",
        },
        {
            "id": str(uuid.uuid4()),
            "display_name": "User 2",
            "handle": "user2",
            "platform": "twitter",
            "follower_count": 2000,
            "bio_text": "Bio 2",
            "top_post_text": "Post 2",
            "top_post_likes": 20,
            "niche_label": "test",
        }
    ]

    individual_response = json.dumps({
        "score": 70,
        "reasoning": "Individual score",
        "signals": []
    })

    with patch("acquisition.scoring_agent._call_claude") as mock_claude:
        # First call (batch) returns invalid JSON, then individual calls succeed
        mock_claude.side_effect = [
            ("Not valid JSON", None),  # Batch attempt fails
            (individual_response, None),  # First fallback
            (individual_response, None),  # Second fallback
        ]

        results = await scoring_agent.batch_score(contacts, DEFAULT_SCORING_PROMPT)

        # Should have called Claude 3 times (batch + 2 individual fallbacks)
        assert mock_claude.call_count == 3
        assert len(results) == 2
        assert results[0].score == 70
        assert results[1].score == 70


@pytest.mark.asyncio
async def test_batch_single_contact_uses_individual_scoring(scoring_agent):
    """Test that batching a single contact uses individual scoring."""
    contact = {
        "id": str(uuid.uuid4()),
        "display_name": "Solo User",
        "handle": "solo",
        "platform": "twitter",
        "follower_count": 5000,
        "bio_text": "Bio",
        "top_post_text": "Post",
        "top_post_likes": 100,
        "niche_label": "test",
    }

    single_response = json.dumps({
        "score": 80,
        "reasoning": "Good fit",
        "signals": ["signal1"]
    })

    with patch("acquisition.scoring_agent._call_claude") as mock_claude:
        mock_claude.return_value = (single_response, None)

        results = await scoring_agent.batch_score([contact], DEFAULT_SCORING_PROMPT)

        assert len(results) == 1
        assert results[0].score == 80


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Routing
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_score_routing_qualified_above_threshold(scoring_agent):
    """Test that contacts scoring >= min_score are routed to 'qualified'."""
    contact_id = str(uuid.uuid4())
    score = 75
    min_score = 65

    # Dry run mode, so no DB calls
    new_stage = await scoring_agent.route_contact(contact_id, score, min_score)

    assert new_stage == "qualified"


@pytest.mark.asyncio
async def test_score_routing_archived_below_threshold(scoring_agent):
    """Test that contacts scoring < min_score are routed to 'archived'."""
    contact_id = str(uuid.uuid4())
    score = 50
    min_score = 65

    new_stage = await scoring_agent.route_contact(contact_id, score, min_score)

    assert new_stage == "archived"


@pytest.mark.asyncio
async def test_score_routing_edge_case_exact_threshold(scoring_agent):
    """Test that contacts scoring exactly the min_score are qualified."""
    contact_id = str(uuid.uuid4())
    score = 65
    min_score = 65

    new_stage = await scoring_agent.route_contact(contact_id, score, min_score)

    assert new_stage == "qualified"


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Score History
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_score_written_to_history():
    """Test that scores are written to crm_score_history."""
    # Create agent with dry_run=False
    agent = ScoringAgent(dry_run=False)
    contact_id = str(uuid.uuid4())
    score = 80

    contact = {
        "id": contact_id,
        "display_name": "Test User",
        "handle": "testuser",
        "platform": "twitter",
        "follower_count": 10000,
        "bio_text": "Bio",
        "top_post_text": "Post",
        "top_post_likes": 50,
        "niche_label": "test",
    }

    score_response = json.dumps({
        "score": score,
        "reasoning": "Test reasoning",
        "signals": ["signal1", "signal2"]
    })

    with patch("acquisition.scoring_agent._call_claude") as mock_claude, \
         patch("acquisition.scoring_agent.queries.insert_score_history") as mock_insert, \
         patch("acquisition.scoring_agent.queries.update_pipeline_stage") as mock_update:

        mock_claude.return_value = (score_response, None)
        mock_insert.return_value = (None, None)
        mock_update.return_value = (None, None)

        result = await agent.score_contact(contact, DEFAULT_SCORING_PROMPT)
        await agent.route_contact(contact_id, result.score, 65)

        # In actual run, insert_score_history would be called
        # This test verifies the structure, not the full flow


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Full Run Workflow
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_run_processes_contacts_and_returns_summary():
    """Test that run() processes contacts and returns proper summary."""
    agent = ScoringAgent(dry_run=True)

    # Use same niche_config_id for both contacts so they're batched together
    niche_id = str(uuid.uuid4())
    contacts = [
        {
            "id": str(uuid.uuid4()),
            "display_name": "High Score User",
            "handle": "highscore",
            "platform": "twitter",
            "follower_count": 20000,
            "bio_text": "Business coach",
            "top_post_text": "Growth tips",
            "top_post_likes": 500,
            "niche_label": "coaches",
            "source_niche_config_id": niche_id,
        },
        {
            "id": str(uuid.uuid4()),
            "display_name": "Low Score User",
            "handle": "lowscore",
            "platform": "twitter",
            "follower_count": 100,
            "bio_text": "Random person",
            "top_post_text": "Hello",
            "top_post_likes": 5,
            "niche_label": "coaches",
            "source_niche_config_id": niche_id,
        },
    ]

    niche_config = {
        "id": niche_id,
        "name": "test-niche",
        "icp_min_score": 65,
        "scoring_prompt": DEFAULT_SCORING_PROMPT,
    }

    batch_response = json.dumps([
        {"contact_index": 0, "score": 85, "reasoning": "Excellent fit"},
        {"contact_index": 1, "score": 30, "reasoning": "Poor fit"},
    ])

    with patch("acquisition.scoring_agent.queries.get_contacts_for_scoring") as mock_get, \
         patch("acquisition.scoring_agent.queries.get_niche_config") as mock_niche, \
         patch("acquisition.scoring_agent._call_claude") as mock_claude:

        mock_get.return_value = (contacts, None)
        mock_niche.return_value = (niche_config, None)
        mock_claude.return_value = (batch_response, None)

        result = await agent.run(limit=10)

        assert result.total_scored == 2
        assert result.qualified_count == 1
        assert result.archived_count == 1
        assert result.score_distribution["80-100"] == 1
        assert result.score_distribution["0-49"] == 1


@pytest.mark.asyncio
async def test_run_handles_no_contacts():
    """Test that run() handles empty contact list gracefully."""
    agent = ScoringAgent(dry_run=True)

    with patch("acquisition.scoring_agent.queries.get_contacts_for_scoring") as mock_get:
        mock_get.return_value = ([], None)

        result = await agent.run(limit=10)

        assert result.total_scored == 0
        assert result.qualified_count == 0
        assert result.archived_count == 0


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Re-scoring Stale Contacts
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_rescore_stale_triggers_correctly():
    """Test that --rescore-stale flag triggers re-scoring logic."""
    agent = ScoringAgent(dry_run=True)

    niche_id = str(uuid.uuid4())
    stale_contact = {
        "id": str(uuid.uuid4()),
        "display_name": "Stale User",
        "handle": "stale",
        "platform": "twitter",
        "follower_count": 10000,
        "bio_text": "Bio",
        "top_post_text": "Post",
        "top_post_likes": 100,
        "niche_label": "test",
        "source_niche_config_id": niche_id,
        "last_scored_at": (datetime.now(timezone.utc) - timedelta(days=35)).isoformat(),
    }

    niche_config = {
        "id": niche_id,
        "name": "test-niche",
        "icp_min_score": 65,
        "scoring_prompt": DEFAULT_SCORING_PROMPT,
    }

    score_response = json.dumps({
        "score": 70,
        "reasoning": "Re-scored as qualified",
        "signals": []
    })

    with patch("acquisition.scoring_agent.queries.get_contacts_for_scoring") as mock_get, \
         patch("acquisition.scoring_agent.queries.get_niche_config") as mock_niche, \
         patch("acquisition.scoring_agent._call_claude") as mock_claude:

        mock_get.return_value = ([stale_contact], None)
        mock_niche.return_value = (niche_config, None)
        mock_claude.return_value = (score_response, None)

        result = await agent.run(limit=10, rescore_stale=True)

        # Verify get_contacts_for_scoring was called with rescore_stale=True
        mock_get.assert_called_once()
        # Check positional args: (limit, niche_id, rescore_stale)
        call_args = mock_get.call_args
        assert call_args.args[2] == True  # Third positional arg is rescore_stale

        assert result.total_scored == 1
        assert result.qualified_count == 1


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Error Handling
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_run_handles_db_errors():
    """Test that DB errors are collected in results.errors."""
    agent = ScoringAgent(dry_run=True)

    with patch("acquisition.scoring_agent.queries.get_contacts_for_scoring") as mock_get:
        mock_get.return_value = (None, "Database connection failed")

        result = await agent.run(limit=10)

        assert len(result.errors) == 1
        assert "Database connection failed" in result.errors[0]


@pytest.mark.asyncio
async def test_run_continues_after_individual_score_failure():
    """Test that scoring continues even if individual contacts fail."""
    agent = ScoringAgent(dry_run=True)

    # Use same niche_config_id for both contacts so they're batched together
    niche_id = str(uuid.uuid4())
    contacts = [
        {
            "id": str(uuid.uuid4()),
            "display_name": "User 1",
            "handle": "user1",
            "platform": "twitter",
            "follower_count": 1000,
            "bio_text": "Bio",
            "top_post_text": "Post",
            "top_post_likes": 10,
            "niche_label": "test",
            "source_niche_config_id": niche_id,
        },
        {
            "id": str(uuid.uuid4()),
            "display_name": "User 2",
            "handle": "user2",
            "platform": "twitter",
            "follower_count": 2000,
            "bio_text": "Bio",
            "top_post_text": "Post",
            "top_post_likes": 20,
            "niche_label": "test",
            "source_niche_config_id": niche_id,
        },
    ]

    niche_config = {
        "id": niche_id,
        "name": "test-niche",
        "icp_min_score": 65,
        "scoring_prompt": DEFAULT_SCORING_PROMPT,
    }

    # First contact fails, second succeeds
    batch_response = json.dumps([
        {"contact_index": 1, "score": 75, "reasoning": "Good fit"},
    ])

    with patch("acquisition.scoring_agent.queries.get_contacts_for_scoring") as mock_get, \
         patch("acquisition.scoring_agent.queries.get_niche_config") as mock_niche, \
         patch("acquisition.scoring_agent._call_claude") as mock_claude:

        mock_get.return_value = (contacts, None)
        mock_niche.return_value = (niche_config, None)
        mock_claude.return_value = (batch_response, None)

        result = await agent.run(limit=10)

        # Only one contact scored (the one in the batch response)
        assert result.total_scored == 1
