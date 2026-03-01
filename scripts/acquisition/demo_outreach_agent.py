#!/usr/bin/env python3
"""
Demo script for Outreach Agent (Agent 05)

Shows how the agent:
1. Fetches contacts ready for DM
2. Builds rich context from posts
3. Generates personalized DMs with Claude
4. Validates message quality
5. Routes to correct platform service
6. Records all touches in database

Usage:
    python3 demo_outreach_agent.py
"""

import asyncio
from datetime import datetime


async def demo_message_validation():
    """Demonstrate message validation rules."""
    print("\n" + "="*60)
    print("DEMO 1: Message Validation")
    print("="*60)

    # Simulated validation (actual validator in outreach_agent.py)
    banned_phrases = [
        "hope this finds you", "reaching out", "quick call",
        "pick your brain", "synergy", "i noticed your profile",
        "would love to connect", "let me know if you're interested",
        "free consultation"
    ]

    test_messages = [
        (
            "Hey! Hope this finds you well. I'm reaching out to pick your brain about a quick call.",
            "Bad: Multiple banned phrases",
            2  # score
        ),
        (
            "Loved your post about \"AI automation for solopreneurs.\" Have you tried batching content with Claude? Happy to share what we're seeing work.",
            "Good: Specific reference, no banned phrases",
            10  # score
        ),
        (
            "x" * 300,
            "Bad: Too long for Twitter",
            6  # score
        ),
    ]

    print(f"\nBanned phrases: {len(banned_phrases)} total")
    print(f"  - hope this finds you, reaching out, quick call, ...")

    for message, description, score in test_messages:
        print(f"\n📝 {description}")
        print(f"   Message: {message[:60]}...")
        passed = score >= 7
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"   {status} — Score: {score}/10")


async def demo_dm_generation():
    """Demonstrate DM generation with Claude."""
    print("\n" + "="*60)
    print("DEMO 2: DM Generation")
    print("="*60)

    # Sample contact context
    print(f"\n👤 Contact: Sarah Chen")
    print(f"   Platform: twitter (@sarahchen)")
    print(f"   ICP Score: 88/100")
    print(f"   Followers: 8,500")
    print(f"   Top Post: \"Just spent 3 hours batching content for next week...\" (247 likes)")

    print(f"\n🤖 Generating personalized DM with Claude...")
    print(f"   Model: claude-haiku-4-5-20251001")
    print(f"   Prompt includes: contact context, top posts, ICP score, service description")

    # Simulated generation (in production, this calls Claude)
    simulated_message = (
        'Sarah — your tweet about "batching content for next week" resonated. '
        'Have you tried using Claude to generate first drafts in batches? '
        'We\'re seeing creators cut their content prep time by 70%. '
        'Curious if you\'ve experimented with AI workflows yet?'
    )

    print(f"\n💬 Generated Message:")
    print(f"   {simulated_message}")

    # Simulated validation
    print(f"\n✅ Validation: 10/10 — PASS")
    print(f"   - Specific reference to their content ✓")
    print(f"   - No banned phrases ✓")
    print(f"   - Under 280 chars ✓")
    print(f"   - Soft ask, not a pitch ✓")


async def demo_platform_routing():
    """Demonstrate platform-specific routing."""
    print("\n" + "="*60)
    print("DEMO 3: Platform Routing")
    print("="*60)

    platforms = [
        ("instagram", "3001", "Single-step: POST /api/messages/send-to"),
        ("twitter", "3003", "Single-step: POST /api/messages/send-to"),
        ("tiktok", "3102", "Single-step: POST /api/messages/send-to"),
        ("linkedin", "3105", "Two-step: 1) /open, 2) /send"),
    ]

    for platform, port, flow in platforms:
        print(f"\n📱 {platform.upper()}")
        print(f"   Port: {port}")
        print(f"   Flow: {flow}")

        if platform == "linkedin":
            print(f"   Step 1: Open conversation with participant name")
            print(f"   Step 2: Send message text")
        else:
            print(f"   Payload: {{username, message}}")


async def demo_touch_recording():
    """Demonstrate database recording."""
    print("\n" + "="*60)
    print("DEMO 4: Touch Recording")
    print("="*60)

    print("\nWhen a DM is sent, the agent records in 4 tables:")

    print("\n1️⃣ crm_messages")
    print("   - contact_id, message_type='dm', is_outbound=true")
    print("   - message_text, sent_at")
    print("   → Creates audit trail for reply detection")

    print("\n2️⃣ acq_outreach_sequences")
    print("   - contact_id, service_slug, touch_number")
    print("   - message_text, platform, status='sent'")
    print("   - platform_message_id (for tracking)")
    print("   → Tracks sequence progression")

    print("\n3️⃣ crm_contacts (updates)")
    print("   - pipeline_stage: 'ready_for_dm' → 'contacted'")
    print("   - last_outbound_at: current timestamp")
    print("   → Advances contact through funnel")

    print("\n4️⃣ acq_funnel_events")
    print("   - from_stage='ready_for_dm', to_stage='contacted'")
    print("   - triggered_by='outreach_agent'")
    print("   → Records transition for analytics")


async def demo_full_agent():
    """Demonstrate full agent execution (dry run)."""
    print("\n" + "="*60)
    print("DEMO 5: Full Agent Execution")
    print("="*60)

    print("\n🚀 Outreach Agent Workflow:")

    print("\n📋 1. Fetch contacts:")
    print("   - Query: pipeline_stage='ready_for_dm'")
    print("   - Order: created_at ASC")
    print("   - Limit: 10")

    print("\n⚙️  2. For each contact:")
    print("   a) Build context")
    print("      - Fetch top 3 posts from market research API")
    print("      - Get latest ICP score & reasoning")
    print("      - Load service description")
    print()
    print("   b) Generate DM")
    print("      - Call Claude API with contact context")
    print("      - Model: claude-haiku-4-5-20251001")
    print("      - Cost: ~$0.0008 per message")
    print()
    print("   c) Validate message")
    print("      - Check length limits")
    print("      - Detect banned phrases")
    print("      - Verify specific content reference")
    print("      - Must score ≥7/10 to pass")
    print()
    print("   d) Check daily cap")
    print("      - Query acq_daily_caps table")
    print("      - Block if limit reached")
    print("      - Increment counter if allowed")
    print()
    print("   e) Send to platform")
    print("      - Route to correct DM service")
    print("      - LinkedIn: 2-step (open + send)")
    print("      - Others: single POST request")
    print()
    print("   f) Record touch in 4 tables")
    print("      - crm_messages (audit trail)")
    print("      - acq_outreach_sequences (sequence tracking)")
    print("      - crm_contacts (update stage + last_outbound_at)")
    print("      - acq_funnel_events (analytics)")

    print("\n📊 3. Return result:")
    print("   - Total processed")
    print("   - Successful sends")
    print("   - Failed sends")
    print("   - Skipped (validation/cap)")

    print("\n💡 Try it yourself:")
    print("   python3 acquisition/outreach_agent.py --dry-run --limit 5")
    print("   python3 acquisition/outreach_agent.py --send --limit 3")
    print("   python3 acquisition/outreach_agent.py --service linkedin-lead-gen")


async def main():
    """Run all demos."""
    import argparse

    parser = argparse.ArgumentParser(description="Demo: Outreach Agent")
    parser.add_argument("--all", action="store_true", help="Run all demos")
    parser.add_argument("--validation", action="store_true", help="Demo message validation")
    parser.add_argument("--generation", action="store_true", help="Demo DM generation")
    parser.add_argument("--routing", action="store_true", help="Demo platform routing")
    parser.add_argument("--recording", action="store_true", help="Demo touch recording")
    parser.add_argument("--agent", action="store_true", help="Demo full agent")

    args = parser.parse_args()

    # Default to all if no specific demo selected
    run_all = args.all or not any([args.validation, args.generation, args.routing, args.recording, args.agent])

    print("\n🎯 OUTREACH AGENT (Agent 05) — DEMO")
    print("Personalized DM generation with Claude AI")
    print(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    if run_all or args.validation:
        await demo_message_validation()

    if run_all or args.generation:
        await demo_dm_generation()

    if run_all or args.routing:
        await demo_platform_routing()

    if run_all or args.recording:
        await demo_touch_recording()

    if run_all or args.agent:
        await demo_full_agent()

    print("\n" + "="*60)
    print("✅ Demo Complete!")
    print("="*60)
    print("\nNext Steps:")
    print("1. Review AGENT_05_SUMMARY.md for full documentation")
    print("2. Run tests: pytest acquisition/tests/test_outreach_agent.py -v")
    print("3. Try dry run: python3 acquisition/outreach_agent.py --dry-run")
    print()


if __name__ == "__main__":
    asyncio.run(main())
