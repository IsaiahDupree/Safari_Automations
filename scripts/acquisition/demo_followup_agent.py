#!/usr/bin/env python3
"""
demo_followup_agent.py — Quick demonstration of AAG Agent 06 functionality

Shows example outputs without requiring database or API keys.
"""

import asyncio
from datetime import datetime, timezone, timedelta


def demo_reply_detection():
    """Demonstrate reply detection logic."""
    print("\n" + "="*60)
    print("DEMO: Reply Detection Logic")
    print("="*60 + "\n")

    contacts = [
        {
            "id": "contact-1",
            "display_name": "Alice Johnson",
            "platform": "twitter",
            "last_outbound_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
            "last_inbound_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        },
        {
            "id": "contact-2",
            "display_name": "Bob Smith",
            "platform": "linkedin",
            "last_outbound_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
            "last_inbound_at": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(),
        },
        {
            "id": "contact-3",
            "display_name": "Carol Davis",
            "platform": "instagram",
            "last_outbound_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
            "last_inbound_at": None,
        },
    ]

    print("Checking contacts for replies...\n")

    for contact in contacts:
        name = contact["display_name"]
        last_out = contact.get("last_outbound_at")
        last_in = contact.get("last_inbound_at")

        if last_in and last_out and last_in > last_out:
            print(f"✓ {name} HAS REPLIED")
            print(f"  Platform: {contact['platform']}")
            print(f"  Last outbound: {last_out[:19]}")
            print(f"  Last inbound:  {last_in[:19]}")
            print(f"  → Action: Notify human, cancel follow-ups, advance to 'replied'\n")
        else:
            print(f"✗ {name} has not replied")
            if last_in is None:
                print(f"  → No inbound messages received\n")
            else:
                print(f"  → Last inbound was BEFORE last outbound\n")


def demo_followup_timing():
    """Demonstrate follow-up timing rules."""
    print("\n" + "="*60)
    print("DEMO: Follow-up Timing Rules")
    print("="*60 + "\n")

    contacts = [
        {
            "name": "Contact A",
            "stage": "contacted",
            "last_outbound_at": (datetime.now(timezone.utc) - timedelta(days=5)).isoformat(),
            "last_inbound_at": None,
        },
        {
            "name": "Contact B",
            "stage": "contacted",
            "last_outbound_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
            "last_inbound_at": None,
        },
        {
            "name": "Contact C",
            "stage": "follow_up_1",
            "last_outbound_at": (datetime.now(timezone.utc) - timedelta(days=4)).isoformat(),
            "last_inbound_at": None,
        },
        {
            "name": "Contact D",
            "stage": "follow_up_2",
            "last_outbound_at": (datetime.now(timezone.utc) - timedelta(days=3, hours=2)).isoformat(),
            "last_inbound_at": None,
        },
    ]

    print("Follow-up Schedule:\n")
    print("  Day 4:  First follow-up  (contacted → follow_up_1)")
    print("  Day 7:  Second follow-up (follow_up_1 → follow_up_2)")
    print("  Day 10: Archive          (follow_up_2 → archived)\n")

    print("-" * 60 + "\n")

    for contact in contacts:
        name = contact["name"]
        stage = contact["stage"]
        last_out = datetime.fromisoformat(contact["last_outbound_at"].replace("Z", "+00:00"))
        days_ago = (datetime.now(timezone.utc) - last_out).days

        print(f"{name}")
        print(f"  Stage: {stage}")
        print(f"  Last outbound: {days_ago} days ago")

        if stage == "contacted" and days_ago >= 4:
            print(f"  → ✅ Ready for FOLLOW-UP 1 (touch 2)")
        elif stage == "contacted":
            print(f"  → ⏳ Wait {4 - days_ago} more days for follow-up 1")

        elif stage == "follow_up_1" and days_ago >= 3:
            print(f"  → ✅ Ready for FOLLOW-UP 2 (touch 3, final)")
        elif stage == "follow_up_1":
            print(f"  → ⏳ Wait {3 - days_ago} more days for follow-up 2")

        elif stage == "follow_up_2" and days_ago >= 3:
            print(f"  → ✅ Ready for ARCHIVAL (no reply after sequence)")
        elif stage == "follow_up_2":
            print(f"  → ⏳ Wait {3 - days_ago} more days before archiving")

        print()


def demo_message_examples():
    """Show example follow-up messages."""
    print("\n" + "="*60)
    print("DEMO: Follow-up Message Examples")
    print("="*60 + "\n")

    print("TOUCH 2 (Day 4 - Different Angle):")
    print("-" * 60)
    print("""
Hey! Quick follow-up — I noticed you've been posting a lot about AI
automation. Have you explored content repurposing tools yet? Would
love to share what's working for creators like you. Interested?
""".strip())
    print()

    print("Characteristics:")
    print("  ✓ Completely different angle from touch 1")
    print("  ✓ Leads with specific observation/data point")
    print("  ✓ 2-3 sentences")
    print("  ✓ Ends with yes/no question")
    print()

    print("-" * 60)
    print("\nTOUCH 3 (Day 7 - Graceful Close):")
    print("-" * 60)
    print("""
Last one from me! If your content workflow ever gets overwhelming,
feel free to reach out. Happy to help.
""".strip())
    print()

    print("Characteristics:")
    print("  ✓ Explicitly final message")
    print("  ✓ Graceful, non-desperate tone")
    print("  ✓ Leaves door open for future")
    print("  ✓ 1-2 sentences")
    print()


def demo_conversation_summary():
    """Show example conversation summary."""
    print("\n" + "="*60)
    print("DEMO: AI Conversation Summary")
    print("="*60 + "\n")

    print("Conversation Thread:")
    print("-" * 60)
    print("Me:   Hey Sarah! Loved your recent post about scaling content")
    print("      with AI. I help creators automate their content pipeline.")
    print("      Would this be helpful for you?")
    print()
    print("Sarah: Thanks for reaching out! I'm actually really interested")
    print("       in this. My biggest pain point is repurposing content")
    print("       across platforms. How does your system handle that?")
    print()
    print("-" * 60)
    print("\nAI-Generated Summary:")
    print("-" * 60)
    print("""
{
  "summary": "Prospect showed interest in content automation, specifically
              asking about cross-platform repurposing capabilities.",
  "sentiment": "interested",
  "recommended_response": "Share specific case study demonstrating
                          cross-platform repurposing workflow"
}
""".strip())
    print()

    print("Human Notification Sent:")
    print("  ✓ Push notification via macOS Notification Center")
    print("  ✓ Email via Mail.app with full conversation context")
    print("  ✓ Link to CRM dashboard for quick response")
    print()


def demo_pipeline_flow():
    """Show complete pipeline flow."""
    print("\n" + "="*60)
    print("DEMO: Complete Pipeline Flow")
    print("="*60 + "\n")

    print("""
DAY 0: Initial outreach sent
  └─> Contact moves to 'contacted' stage
  └─> Timer starts for follow-up 1

DAY 4: No reply → Follow-up 1
  ├─> AI generates follow-up message (different angle)
  ├─> Message scheduled via outreach queue
  ├─> Contact moves to 'follow_up_1' stage
  └─> Timer starts for follow-up 2

DAY 7: Still no reply → Follow-up 2 (Final)
  ├─> AI generates final message (graceful close)
  ├─> Message scheduled via outreach queue
  ├─> Contact moves to 'follow_up_2' stage
  └─> Timer starts for archival

DAY 10: Still no reply → Archive
  ├─> Contact moves to 'archived' stage
  ├─> archived_at timestamp set
  ├─> Funnel event recorded (reason: no_reply_after_sequence)
  └─> Re-entry possible after 180 days

═══════════════════════════════════════════════════════════

ALTERNATE PATH: Reply received at ANY time
  ├─> Contact moves to 'replied' stage
  ├─> All pending follow-ups CANCELLED (DM + email)
  ├─> AI generates conversation summary
  ├─> Push notification sent to human
  ├─> Email notification sent to human
  └─> Human takes over conversation
""")
    print()


async def main():
    """Run all demos."""
    print("\n" + "═"*60)
    print("  AAG AGENT 06: Follow-up & Human Notification Agent")
    print("  DEMONSTRATION MODE")
    print("═"*60)

    demo_reply_detection()
    demo_followup_timing()
    demo_message_examples()
    demo_conversation_summary()
    demo_pipeline_flow()

    print("\n" + "═"*60)
    print("  Demo Complete!")
    print("  To run the actual agent, use:")
    print("    python3 acquisition/followup_agent.py --process")
    print("═"*60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
