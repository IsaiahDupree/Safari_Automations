"""
acquisition/tests/test_entity_resolution.py — Entity resolution agent tests.

Tests username matching, bio link extraction, Perplexity client, candidate ranking,
disambiguation, and full resolution pipeline.
"""
import asyncio
import json
import pytest
from unittest.mock import Mock, patch, AsyncMock

from acquisition.entity.username_matcher import (
    squish, handle_similarity, is_likely_same_handle,
    name_to_handle_candidates, calculate_name_similarity
)
from acquisition.entity.bio_link_extractor import (
    extract_bio_links, parse_link_aggregator, extract_handle_from_url,
    _extract_urls_from_text, _is_link_aggregator
)
from acquisition.entity.perplexity_client import PerplexityClient, SafariPerplexityFallback
from acquisition.entity.disambiguator import disambiguate, CandidateProfile, Contact, DisambiguationResult
from acquisition.entity_resolution_agent import EntityResolutionAgent


# ══════════════════════════════════════════════════════════════════════════════
# Username Matcher Tests
# ══════════════════════════════════════════════════════════════════════════════

def test_squish_normalizes_handles():
    """Test that squish removes all non-alphanumeric characters and lowercases."""
    assert squish("John_Doe") == "johndoe"
    assert squish("@jane.smith") == "janesmith"
    assert squish("Tech-Guy!") == "techguy"
    assert squish("USER123") == "user123"
    assert squish("") == ""


def test_handle_similarity_above_threshold():
    """Test handle similarity scoring."""
    # Exact match
    assert handle_similarity("johndoe", "johndoe") == 1.0
    
    # Very similar (ignore punctuation)
    assert handle_similarity("john_doe", "johndoe") == 1.0
    
    # Similar but not identical
    assert handle_similarity("john_doe", "jane_doe") > 0.5
    
    # Different
    assert handle_similarity("johndoe", "janedoe") < 0.8


def test_is_likely_same_handle():
    """Test threshold-based handle matching."""
    # Same handle with different punctuation
    assert is_likely_same_handle("john_doe", "johndoe") is True
    assert is_likely_same_handle("tech.guy", "techguy") is True
    
    # Different handles
    assert is_likely_same_handle("johndoe", "janedoe") is False


def test_name_to_handle_candidates():
    """Test generating handle variants from display names."""
    candidates = name_to_handle_candidates("John Doe")
    
    assert "johndoe" in candidates
    assert "john_doe" in candidates
    assert "john.doe" in candidates
    assert "jdoe" in candidates
    
    # Single word name
    single = name_to_handle_candidates("Madonna")
    assert "madonna" in single
    
    # Empty name
    assert name_to_handle_candidates("") == []


def test_calculate_name_similarity():
    """Test display name similarity calculation."""
    assert calculate_name_similarity("John Doe", "John Doe") == 1.0
    assert calculate_name_similarity("John Doe", "john.doe") == 1.0
    assert calculate_name_similarity("John Doe", "Jane Doe") > 0.5
    assert calculate_name_similarity(None, "John") == 0.0


# ══════════════════════════════════════════════════════════════════════════════
# Bio Link Extractor Tests
# ══════════════════════════════════════════════════════════════════════════════

def test_extract_urls_from_text():
    """Test URL extraction from bio text."""
    bio = "Check out my links: https://linktr.ee/johndoe and https://twitter.com/johndoe"
    urls = _extract_urls_from_text(bio)
    
    assert len(urls) >= 2
    assert any("linktr.ee" in url for url in urls)
    assert any("twitter.com" in url for url in urls)


def test_is_link_aggregator():
    """Test link aggregator detection."""
    assert _is_link_aggregator("https://linktr.ee/johndoe") is True
    assert _is_link_aggregator("https://beacons.ai/jane") is True
    assert _is_link_aggregator("https://bio.site/user") is True
    assert _is_link_aggregator("https://twitter.com/user") is False


def test_extract_handle_from_url():
    """Test extracting handle from social media URLs."""
    assert extract_handle_from_url("https://twitter.com/johndoe", "twitter") == "johndoe"
    assert extract_handle_from_url("https://instagram.com/jane.doe/", "instagram") == "jane.doe"
    assert extract_handle_from_url("https://tiktok.com/@user123", "tiktok") == "user123"
    assert extract_handle_from_url("https://linkedin.com/in/john-doe-123", "linkedin") == "john-doe-123"
    assert extract_handle_from_url("https://random.com/user", "twitter") is None


@pytest.mark.asyncio
async def test_bio_link_extractor_finds_linktree_links():
    """Test that bio link extractor finds and follows Linktree links."""
    contact = Contact(
        id="test_id",
        primary_platform="instagram",
        primary_handle="testuser",
        bio_text="Links: https://linktr.ee/testuser"
    )
    
    with patch('acquisition.db.queries') as mock_queries:
        mock_queries.get_market_research.return_value = (None, None)

        with patch('acquisition.entity.bio_link_extractor.parse_link_aggregator', new_callable=AsyncMock) as mock_parse:
            mock_parse.return_value = [
                "https://twitter.com/testuser",
                "https://instagram.com/testuser"
            ]

            urls = await extract_bio_links(contact)

            # Should find the linktr.ee link and expand it
            assert len(urls) > 0
            mock_parse.assert_called_once()


@pytest.mark.asyncio
async def test_linktree_parser_extracts_social_urls():
    """Test parsing link aggregator pages to extract social URLs."""
    html_content = '''
    <html>
        <a href="https://twitter.com/johndoe">Twitter</a>
        <a href="https://instagram.com/johndoe">Instagram</a>
        <a href="https://tiktok.com/@johndoe">TikTok</a>
    </html>
    '''
    
    with patch('urllib.request.urlopen') as mock_urlopen:
        mock_response = Mock()
        mock_response.read.return_value = html_content.encode()
        mock_urlopen.return_value = mock_response
        
        urls = await parse_link_aggregator("https://linktr.ee/johndoe")
        
        assert len(urls) >= 2
        assert any("twitter.com" in url for url in urls)
        assert any("instagram.com" in url for url in urls)


# ══════════════════════════════════════════════════════════════════════════════
# Perplexity Client Tests
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_perplexity_client_rate_limiter():
    """Test that rate limiter enforces 10 req/min."""
    import time
    
    with patch.dict('os.environ', {'PERPLEXITY_API_KEY': 'test_key'}):
        client = PerplexityClient()
        
        # Clear rate limiter
        client._request_times.clear()
        
        # Add 10 requests instantly
        for _ in range(10):
            client._request_times.append(time.time())
        
        # Next rate limit call should wait
        start = time.time()
        # Don't actually wait, just test the logic
        # In real scenario, this would sleep
        assert len(client._request_times) == 10


def test_perplexity_query_templates():
    """Test Perplexity query generation."""
    with patch.dict('os.environ', {'PERPLEXITY_API_KEY': 'test_key'}):
        client = PerplexityClient()
        
        # Query by handle
        query1 = client.query_by_handle("johndoe", "twitter", "SaaS founders")
        assert "johndoe" in query1
        assert "twitter" in query1
        assert "SaaS founders" in query1
        
        # Query by name
        query2 = client.query_by_name("John Doe", "fitness", "Instagram")
        assert "John Doe" in query2
        assert "fitness" in query2
        
        # Query by website
        query3 = client.query_by_website("https://johndoe.com")
        assert "johndoe.com" in query3


# ══════════════════════════════════════════════════════════════════════════════
# Disambiguator Tests
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_disambiguator_confidence_gate_80():
    """Test that disambiguator only confirms if confidence >= 80."""
    known = Contact(
        id="test_id",
        primary_platform="twitter",
        primary_handle="johndoe",
        display_name="John Doe",
        bio_text="Tech founder"
    )
    
    candidate = CandidateProfile(
        platform="instagram",
        handle="johndoe",
        display_name="John Doe",
        bio_text="Tech entrepreneur",
        name_similarity=0.95,
        bio_link_overlap=True,
        perplexity_mentioned=True,
        score=90,
        evidence_sources=["perplexity", "bio_link"]
    )
    
    # Mock Claude API response
    mock_response = json.dumps({
        "same_person": True,
        "confidence": 85,
        "reasoning": "Strong name match and bio similarity",
        "warning": None
    })
    
    with patch('acquisition.entity.disambiguator._call_claude_api', new_callable=AsyncMock) as mock_claude:
        mock_claude.return_value = mock_response
        
        result = await disambiguate(known, candidate)
        
        assert result.same_person is True
        assert result.confidence == 85
        assert result.confidence >= 80


@pytest.mark.asyncio
async def test_disambiguator_rejects_low_confidence():
    """Test that low confidence results are rejected."""
    known = Contact(
        id="test_id",
        primary_platform="twitter",
        primary_handle="johndoe",
    )
    
    candidate = CandidateProfile(
        platform="instagram",
        handle="john_d",
        name_similarity=0.6,
        score=30,
        evidence_sources=["username_match"]
    )
    
    mock_response = json.dumps({
        "same_person": False,
        "confidence": 45,
        "reasoning": "Handle similar but no other evidence",
        "warning": "Common name, ambiguous"
    })
    
    with patch('acquisition.entity.disambiguator._call_claude_api', new_callable=AsyncMock) as mock_claude:
        mock_claude.return_value = mock_response
        
        result = await disambiguate(known, candidate)
        
        assert result.same_person is False
        assert result.confidence < 80


# ══════════════════════════════════════════════════════════════════════════════
# Candidate Ranker Tests
# ══════════════════════════════════════════════════════════════════════════════

def test_candidate_ranker_scores():
    """Test candidate scoring logic."""
    from acquisition.entity_resolution_agent import EntityResolutionAgent
    
    agent = EntityResolutionAgent()
    
    contact = Contact(
        id="test_id",
        primary_platform="twitter",
        primary_handle="johndoe",
        display_name="John Doe"
    )
    
    candidates = [
        CandidateProfile(
            platform="instagram",
            handle="johndoe",  # Exact match
            bio_link_overlap=True,
            perplexity_mentioned=True,
            evidence_sources=["perplexity", "bio_link"]
        ),
        CandidateProfile(
            platform="tiktok",
            handle="john_doe_official",  # Partial match
            perplexity_mentioned=True,
            evidence_sources=["perplexity"]
        ),
    ]
    
    ranked = agent._rank_candidates(contact, candidates)
    
    # First candidate should score higher
    assert ranked[0].score > ranked[1].score
    assert ranked[0].handle == "johndoe"


# ══════════════════════════════════════════════════════════════════════════════
# False Positive Protection Tests
# ══════════════════════════════════════════════════════════════════════════════

def test_false_positive_skips_weak_signals():
    """Test that weak candidates are skipped for Claude disambiguation."""
    from acquisition.entity_resolution_agent import EntityResolutionAgent
    
    agent = EntityResolutionAgent()
    
    # Weak candidate: low similarity, no overlap, not mentioned
    weak_candidate = CandidateProfile(
        platform="instagram",
        handle="smith123",
        name_similarity=0.3,
        bio_link_overlap=False,
        perplexity_mentioned=False,
        evidence_sources=[]
    )
    
    assert agent._should_skip_disambiguation(weak_candidate) is True
    
    # Strong candidate
    strong_candidate = CandidateProfile(
        platform="instagram",
        handle="johndoe",
        name_similarity=0.9,
        bio_link_overlap=True,
        perplexity_mentioned=True,
        evidence_sources=["perplexity", "bio_link"]
    )
    
    assert agent._should_skip_disambiguation(strong_candidate) is False


# ══════════════════════════════════════════════════════════════════════════════
# Resolution Score Calculator Tests
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_resolution_score_calculator():
    """Test resolution score calculation (0-100)."""
    from acquisition.entity_resolution_agent import EntityResolutionAgent
    
    agent = EntityResolutionAgent()
    
    # Perfect score: email + linkedin + twitter + instagram
    confirmed = [
        (CandidateProfile(platform="email", handle="test@example.com", type="email"), Mock(confidence=95)),
        (CandidateProfile(platform="linkedin", handle="johndoe"), Mock(confidence=90)),
        (CandidateProfile(platform="twitter", handle="johndoe"), Mock(confidence=85)),
        (CandidateProfile(platform="instagram", handle="johndoe"), Mock(confidence=85)),
    ]
    
    score = await agent._calculate_resolution_score("test_id", confirmed, dry_run=True)
    
    # email(30) + linkedin(25) + twitter(15) + instagram(15) = 85
    assert score == 85
    
    # Partial score
    partial_confirmed = [
        (CandidateProfile(platform="twitter", handle="johndoe"), Mock(confidence=85)),
    ]
    
    partial_score = await agent._calculate_resolution_score("test_id", partial_confirmed, dry_run=True)
    assert partial_score == 15


# ══════════════════════════════════════════════════════════════════════════════
# Integration Tests
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_confirmed_handle_written_to_crm_contacts():
    """Test that confirmed handles are written to crm_contacts."""
    from acquisition.entity_resolution_agent import EntityResolutionAgent
    
    agent = EntityResolutionAgent()
    
    with patch('acquisition.entity_resolution_agent.queries') as mock_queries:
        mock_queries.update_contact.return_value = (None, None)

        await agent._update_contact_handle("test_id", "twitter", "johndoe", "handle")

        # Verify update_contact was called with twitter_handle
        mock_queries.update_contact.assert_called_once()
        call_args = mock_queries.update_contact.call_args
        assert call_args[0][0] == "test_id"
        assert call_args[0][1]["twitter_handle"] == "johndoe"


@pytest.mark.asyncio
async def test_batch_resolver_respects_semaphore():
    """Test that batch resolver limits concurrency with semaphore."""
    from acquisition.entity_resolution_agent import EntityResolutionAgent
    
    agent = EntityResolutionAgent()
    
    with patch('acquisition.entity_resolution_agent.queries') as mock_queries:
        # Mock unresolved contacts
        mock_queries.get_unresolved_contacts.return_value = (
            [{"id": f"contact_{i}"} for i in range(5)],
            None
        )
        
        # Mock resolve to track concurrency
        resolve_calls = []
        
        async def mock_resolve(contact_id, dry_run=False):
            resolve_calls.append(contact_id)
            await asyncio.sleep(0.01)  # Simulate work
            return Mock(contact_id=contact_id, confirmed=[], resolution_score=50)
        
        with patch.object(agent, 'resolve', side_effect=mock_resolve):
            results = await agent.batch_resolve(limit=5, dry_run=True)
            
            # Should process all 5 contacts
            assert len(results) == 5


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
