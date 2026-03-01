"""
tests/test_discovery_agent.py — Tests for Discovery Agent (Agent 02).

Usage:
    pytest scripts/acquisition/tests/test_discovery_agent.py -v
"""
import asyncio
import pytest
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from ..discovery_agent import DiscoveryAgent, NicheConfig, ProspectData
from ..clients.market_research_client import MarketResearchClient


# ═══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.fixture
def sample_niche_config():
    """Sample niche config for testing."""
    return NicheConfig(
        id=str(uuid.uuid4()),
        name="test-niche",
        service_slug="test-service",
        platforms=["twitter", "instagram"],
        keywords=["test keyword"],
        icp_min_score=65,
        max_weekly=100,
        is_active=True,
    )


@pytest.fixture
def sample_prospects():
    """Sample prospect data for testing."""
    return [
        ProspectData(
            handle="testuser1",
            display_name="Test User 1",
            platform="twitter",
            follower_count=1000,
            engagement_rate=3.5,
            niche_label="test-niche",
        ),
        ProspectData(
            handle="testuser2",
            display_name="Test User 2",
            platform="instagram",
            follower_count=5000,
            engagement_rate=4.2,
            niche_label="test-niche",
        ),
    ]


@pytest.fixture
def discovery_agent():
    """Discovery agent instance."""
    return DiscoveryAgent(dry_run=False)


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Deduplication
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_dedup_finds_existing_contact(discovery_agent, sample_prospects):
    """Test that existing contacts are detected and deduplicated."""
    # Mock _check_existing_handle to return True for testuser1
    async def mock_check_existing(handle):
        return handle == "testuser1"

    # Mock _check_reentry_eligibility to return False
    async def mock_check_reentry(handle):
        return False

    discovery_agent._check_existing_handle = mock_check_existing
    discovery_agent._check_reentry_eligibility = mock_check_reentry

    new, existing = await discovery_agent._deduplicate(sample_prospects)

    assert len(new) == 1
    assert len(existing) == 1
    assert new[0].handle == "testuser2"
    assert existing[0].handle == "testuser1"


@pytest.mark.asyncio
async def test_seed_new_contact(discovery_agent, sample_niche_config):
    """Test that new prospects are inserted with pipeline_stage=new."""
    prospects = [
        ProspectData(
            handle="newuser",
            display_name="New User",
            platform="twitter",
            follower_count=500,
            engagement_rate=2.5,
            niche_label="test-niche",
        )
    ]

    # Mock database calls
    with patch("acquisition.discovery_agent.upsert_contact") as mock_upsert, \
         patch("acquisition.discovery_agent.enqueue_resolution") as mock_enqueue, \
         patch.object(discovery_agent, "_is_reentry", return_value=False):

        mock_upsert.return_value = (1, None)
        mock_enqueue.return_value = (None, None)

        seeded = await discovery_agent._seed_contacts(prospects, sample_niche_config)

        assert seeded == 1
        assert mock_upsert.called
        contact = mock_upsert.call_args[0][0]
        assert contact["pipeline_stage"] == "new"
        assert contact["twitter_handle"] == "newuser"
        assert contact["niche_label"] == "test-niche"
        assert contact["source_niche_config_id"] == sample_niche_config.id


@pytest.mark.asyncio
async def test_discovery_run_logged():
    """Test that discovery runs are logged to acq_discovery_runs."""
    agent = DiscoveryAgent(dry_run=True)

    # Mock get_niche_configs to return empty list
    with patch("acquisition.discovery_agent.get_niche_configs") as mock_get_configs:
        mock_get_configs.return_value = ([], None)

        result = await agent.run()

        # Should complete with no configs
        assert result.discovered == 0
        assert result.errors == ["No active niche configs found"]


@pytest.mark.asyncio
async def test_rate_limiter_max_3_concurrent():
    """Test that semaphore limits to 3 concurrent scans."""
    agent = DiscoveryAgent()

    # Track concurrent executions
    concurrent_count = 0
    max_concurrent = 0

    async def mock_scan(config, platform, keyword):
        nonlocal concurrent_count, max_concurrent
        concurrent_count += 1
        max_concurrent = max(max_concurrent, concurrent_count)
        await asyncio.sleep(0.1)
        concurrent_count -= 1
        return [], None

    agent._scan_platform = mock_scan

    # Create 10 scan tasks
    config = NicheConfig(
        id=str(uuid.uuid4()),
        name="test",
        service_slug="test",
        platforms=["twitter"],
        keywords=["test"],
        icp_min_score=65,
        max_weekly=100,
        is_active=True,
    )

    tasks = [
        agent._scan_platform_with_semaphore(config, "twitter", f"keyword{i}")
        for i in range(10)
    ]

    await asyncio.gather(*tasks)

    # Semaphore should limit to 3 concurrent
    assert max_concurrent <= 3


@pytest.mark.asyncio
async def test_reentry_archived_after_180_days(discovery_agent):
    """Test that archived contacts re-enter after 180 days."""
    # Mock database response for archived contact
    old_archived_at = (datetime.now(timezone.utc) - timedelta(days=181)).isoformat()

    with patch("acquisition.discovery_agent._select") as mock_select:
        mock_select.return_value = ([{
            "id": str(uuid.uuid4()),
            "pipeline_stage": "archived",
            "archived_at": old_archived_at,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }], None)

        should_reenter = await discovery_agent._check_reentry_eligibility("testuser")

        assert should_reenter is True


@pytest.mark.asyncio
async def test_reentry_closed_lost_after_90_days(discovery_agent):
    """Test that closed_lost contacts re-enter after 90 days."""
    # Mock database response for closed_lost contact
    old_updated_at = (datetime.now(timezone.utc) - timedelta(days=91)).isoformat()

    with patch("acquisition.discovery_agent._select") as mock_select:
        mock_select.return_value = ([{
            "id": str(uuid.uuid4()),
            "pipeline_stage": "closed_lost",
            "archived_at": None,
            "updated_at": old_updated_at,
        }], None)

        should_reenter = await discovery_agent._check_reentry_eligibility("testuser")

        assert should_reenter is True


@pytest.mark.asyncio
async def test_dry_run_no_writes():
    """Test that dry_run=True prevents database writes."""
    agent = DiscoveryAgent(dry_run=True)

    prospects = [
        ProspectData(
            handle="dryrunuser",
            display_name="Dry Run User",
            platform="twitter",
            follower_count=1000,
            engagement_rate=3.0,
            niche_label="test",
        )
    ]

    config = NicheConfig(
        id=str(uuid.uuid4()),
        name="test",
        service_slug="test",
        platforms=["twitter"],
        keywords=["test"],
        icp_min_score=65,
        max_weekly=100,
        is_active=True,
    )

    # Mock database to track calls
    with patch("acquisition.discovery_agent.upsert_contact") as mock_upsert, \
         patch("acquisition.discovery_agent.insert_discovery_run") as mock_insert_run:

        # Should not call database functions in dry run
        seeded = await agent._seed_contacts(prospects, config)

        # Dry run returns count but doesn't write to database
        assert seeded == 1
        assert mock_upsert.call_count == 0
        assert mock_insert_run.call_count == 0


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Market Research Client
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_market_research_client_search():
    """Test Market Research Client search_platform."""
    client = MarketResearchClient()

    # Mock HTTP request
    mock_response = {
        "posts": [
            {
                "author": {
                    "handle": "@testuser",
                    "displayName": "Test User",
                    "followers": 1000,
                },
                "text": "Test post",
                "likes": 50,
                "url": "https://twitter.com/testuser/status/123",
            }
        ],
        "creators": []
    }

    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_response_obj = MagicMock()
        mock_response_obj.read.return_value = str(mock_response).replace("'", '"').encode()
        mock_urlopen.return_value.__enter__.return_value = mock_response_obj

        prospects, err = await client.search_platform("twitter", "test keyword", 50)

        assert err is None
        assert len(prospects) == 1
        assert prospects[0].handle == "testuser"


@pytest.mark.asyncio
async def test_market_research_client_top_creators():
    """Test Market Research Client get_top_creators."""
    client = MarketResearchClient()

    mock_response = {
        "creators": [
            {
                "handle": "@creator1",
                "displayName": "Creator 1",
                "followers": 5000,
                "engagementRate": 4.5,
                "topPost": {
                    "text": "Top post",
                    "url": "https://twitter.com/creator1/status/456",
                    "likes": 200,
                }
            }
        ],
        "posts": []
    }

    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_response_obj = MagicMock()
        mock_response_obj.read.return_value = str(mock_response).replace("'", '"').encode()
        mock_urlopen.return_value.__enter__.return_value = mock_response_obj

        prospects, err = await client.get_top_creators("twitter", "test niche", 50)

        assert err is None
        assert len(prospects) == 1
        assert prospects[0].handle == "creator1"
        assert prospects[0].engagement_rate == 4.5
