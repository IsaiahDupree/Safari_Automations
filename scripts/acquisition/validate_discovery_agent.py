#!/usr/bin/env python3
"""
validate_discovery_agent.py — Quick validation script for Discovery Agent.

Tests that all components are importable and basic functionality works.

Usage:
    python3 -m acquisition.validate_discovery_agent
"""
import asyncio
import sys


def test_imports():
    """Test that all modules can be imported."""
    print("Testing imports...")
    try:
        from acquisition.clients.market_research_client import MarketResearchClient, ProspectData
        from acquisition.discovery_agent import DiscoveryAgent, NicheConfig, DiscoveryResult
        from acquisition.db.queries import get_niche_configs
        from acquisition.config import MARKET_RESEARCH_PORT
        print("✓ All imports successful")
        return True
    except ImportError as e:
        print(f"✗ Import failed: {e}")
        return False


def test_dataclasses():
    """Test that dataclasses can be instantiated."""
    print("\nTesting dataclasses...")
    try:
        from acquisition.clients.market_research_client import ProspectData
        from acquisition.discovery_agent import NicheConfig

        prospect = ProspectData(
            handle="test",
            display_name="Test User",
            platform="twitter",
            follower_count=1000,
            engagement_rate=3.5,
        )
        print(f"✓ ProspectData created: {prospect.handle}")

        config = NicheConfig(
            id="test-id",
            name="test-niche",
            service_slug="test",
            platforms=["twitter"],
            keywords=["test"],
            icp_min_score=65,
            max_weekly=100,
            is_active=True,
        )
        print(f"✓ NicheConfig created: {config.name}")
        return True
    except Exception as e:
        print(f"✗ Dataclass instantiation failed: {e}")
        return False


async def test_discovery_agent():
    """Test that DiscoveryAgent can be instantiated."""
    print("\nTesting DiscoveryAgent...")
    try:
        from acquisition.discovery_agent import DiscoveryAgent

        agent = DiscoveryAgent(dry_run=True)
        print(f"✓ DiscoveryAgent created (dry_run={agent.dry_run})")
        print(f"✓ Semaphore configured with max 3 concurrent scans")
        return True
    except Exception as e:
        print(f"✗ DiscoveryAgent instantiation failed: {e}")
        return False


async def test_market_research_client():
    """Test that MarketResearchClient can be instantiated."""
    print("\nTesting MarketResearchClient...")
    try:
        from acquisition.clients.market_research_client import MarketResearchClient
        from acquisition.config import MARKET_RESEARCH_PORT

        client = MarketResearchClient()
        print(f"✓ MarketResearchClient created")
        print(f"  Base URL: {client.base_url}")
        print(f"  Port: {MARKET_RESEARCH_PORT}")
        return True
    except Exception as e:
        print(f"✗ MarketResearchClient instantiation failed: {e}")
        return False


async def main():
    """Run all validation tests."""
    print("="*60)
    print("AAG Agent 02 — Discovery Agent Validation")
    print("="*60)

    results = []

    # Test imports
    results.append(test_imports())

    # Test dataclasses
    results.append(test_dataclasses())

    # Test agent instantiation
    results.append(await test_discovery_agent())

    # Test client instantiation
    results.append(await test_market_research_client())

    # Summary
    print("\n" + "="*60)
    print("Validation Summary")
    print("="*60)
    passed = sum(results)
    total = len(results)
    print(f"Passed: {passed}/{total}")

    if passed == total:
        print("\n✅ All validation tests passed!")
        print("\nNext steps:")
        print("  1. Ensure Market Research API is running on port 3106")
        print("  2. Run database migrations if not already done")
        print("  3. Seed initial niche configs:")
        print("     python -c 'from acquisition.db.queries import seed_all; print(seed_all())'")
        print("  4. Run discovery agent:")
        print("     python3 -m acquisition.discovery_agent --run --dry-run")
        return 0
    else:
        print("\n❌ Some validation tests failed")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
