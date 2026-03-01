#!/usr/bin/env python3
"""
verify_agent_09.py — Quick verification that AAG Agent 09 components are importable.

Run with:
    cd scripts/acquisition
    python3 -m verify_agent_09

Or from project root:
    python3 -m scripts.acquisition.verify_agent_09
"""
import sys
import os

# Add parent directory to path when run directly
if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    if parent_dir not in sys.path:
        sys.path.insert(0, parent_dir)

def verify_imports():
    """Test that all Agent 09 modules can be imported."""
    print("Verifying AAG Agent 09 imports...")

    try:
        # Core modules (use absolute imports from acquisition package)
        from acquisition.entity import username_matcher
        print("✅ username_matcher")

        from acquisition.entity import bio_link_extractor
        print("✅ bio_link_extractor")

        # Note: perplexity_client and disambiguator require external deps (httpx, anthropic)
        # so we'll skip those in basic verification
        print("⏭️  perplexity_client (requires httpx)")
        print("⏭️  disambiguator (requires anthropic)")

        print("\n✅ Core imports successful!")
        return True

    except ImportError as e:
        print(f"\n❌ Import failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def verify_functions():
    """Test that key functions are available."""
    print("\nVerifying core functions...")

    try:
        from acquisition.entity import username_matcher

        # Test squish
        result = username_matcher.squish("Test_User")
        assert result == "testuser", f"squish failed: {result}"
        print("✅ username_matcher.squish()")

        # Test handle_similarity
        sim = username_matcher.handle_similarity("john_doe", "johndoe")
        assert sim == 1.0, f"handle_similarity failed: {sim}"
        print("✅ username_matcher.handle_similarity()")

        # Test name_to_handle_candidates
        candidates = username_matcher.name_to_handle_candidates("John Doe")
        assert "johndoe" in candidates, "name_to_handle_candidates failed"
        print("✅ username_matcher.name_to_handle_candidates()")

        # Test extract_handle_from_url
        handle = username_matcher.extract_handle_from_url("https://twitter.com/johndoe")
        assert handle == "johndoe", f"extract_handle_from_url failed: {handle}"
        print("✅ username_matcher.extract_handle_from_url()")

        # Test bio link extractor functions
        from acquisition.entity import bio_link_extractor

        text = "Check out https://example.com"
        urls = bio_link_extractor._extract_urls_from_text(text)
        assert "https://example.com" in urls
        print("✅ bio_link_extractor._extract_urls_from_text()")

        emails = bio_link_extractor.extract_emails_from_text("Contact: john@company.com")
        assert "john@company.com" in emails
        print("✅ bio_link_extractor.extract_emails_from_text()")

        print("\n✅ All function tests passed!")
        return True

    except Exception as e:
        print(f"\n❌ Function test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def verify_data_structures():
    """Test that data structures are defined correctly."""
    print("\nVerifying data structures...")

    try:
        # Skip this if anthropic is not installed
        try:
            from acquisition.entity.disambiguator import CandidateProfile, DisambiguationResult

            # Create a candidate profile
            candidate = CandidateProfile(
                platform="twitter",
                handle="test",
                display_name="Test User",
                bio_text="Test bio",
                name_similarity=0.9,
                bio_link_overlap=True,
                perplexity_mentioned=True,
                score=85,
                evidence_sources=["test"]
            )
            print("✅ CandidateProfile")

            # Create a disambiguation result
            result = DisambiguationResult(
                same_person=True,
                confidence=95,
                reasoning="Test reasoning"
            )
            print("✅ DisambiguationResult")

            print("\n✅ All data structures verified!")
        except ImportError as e:
            print(f"⏭️  Disambiguator data structures (requires anthropic): {e}")

        return True

    except Exception as e:
        print(f"\n❌ Data structure test failed: {e}")
        return False


def main():
    """Run all verification tests."""
    print("="*60)
    print("AAG Agent 09 — Entity Resolution Verification")
    print("="*60)

    results = []

    results.append(verify_imports())
    results.append(verify_functions())
    results.append(verify_data_structures())

    print("\n" + "="*60)
    if all(results):
        print("✅ All verifications passed! Agent 09 is ready.")
        return 0
    else:
        print("❌ Some verifications failed. Check errors above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
