#!/usr/bin/env python3
"""
acquisition/followup_agent.py — AAG Agent 06: Follow-up & Human Notification Agent

Mission:
  1. Detect replies via inbox sync
  2. Send Day 4 and Day 7 follow-up DMs for non-responders
  3. Archive contacts after Day 7+ with no reply
  4. Notify human when prospects reply

Usage:
  python3 acquisition/followup_agent.py --process       # Full cycle: sync + detect + follow-up
  python3 acquisition/followup_agent.py --show-pending  # List pending follow-ups
  python3 acquisition/followup_agent.py --dry-run       # Show what would happen (no actions)
"""

import asyncio
import os
import sys
import json
import subprocess
from pathlib import Path
from typing import Any, Optional
from datetime import datetime, timezone

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from acquisition import config
from acquisition.db import queries
from acquisition.notification_client import NotificationClient


# ── Claude API for conversation summaries ────────────────────────────────────

async def call_claude(prompt: str, model: str = config.CLAUDE_MODEL_GENERATION) -> str:
    """Call Claude API for text generation."""
    import urllib.request
    import urllib.error

    if not config.ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY not set")

    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    body = {
        "model": model,
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": prompt}],
    }

    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read())
            return result["content"][0]["text"]
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        raise RuntimeError(f"Claude API error {e.code}: {err_body}")
    except Exception as e:
        raise RuntimeError(f"Claude API call failed: {e}")


# ── Reply Detection ───────────────────────────────────────────────────────────

class ReplyDetector:
    """Detects when prospects reply via inbox sync."""

    def __init__(self, crm_brain_path: str = None):
        if crm_brain_path is None:
            # Default to ../crm_brain.py
            base_path = Path(__file__).parent.parent
            crm_brain_path = str(base_path / "crm_brain.py")
        self.crm_brain_path = crm_brain_path

    async def trigger_crm_sync(self) -> tuple[bool, Optional[str]]:
        """
        Trigger crm_brain.py --sync to pull latest messages.

        Returns:
            Tuple of (success, error_message)
        """
        try:
            print(f"[ReplyDetector] Running: python3 {self.crm_brain_path} --sync")

            proc = await asyncio.create_subprocess_exec(
                "python3",
                self.crm_brain_path,
                "--sync",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                error_msg = stderr.decode() if stderr else "Unknown error"
                return False, f"CRM sync failed: {error_msg}"

            print(f"[ReplyDetector] Sync completed successfully")
            return True, None

        except Exception as e:
            return False, f"Exception during sync: {e}"

    async def sync_and_detect(self) -> list[dict[str, Any]]:
        """
        Sync inbox and detect contacts with new replies.

        Returns:
            List of contacts who have replied (last_inbound_at > last_outbound_at)
        """
        # Step 1: Trigger inbox sync
        success, err = await self.trigger_crm_sync()
        if not success:
            print(f"[ReplyDetector] Warning: Sync failed - {err}")
            print("[ReplyDetector] Continuing with existing data...")

        # Step 2: Query contacts with replies
        contacts, err = queries.get_contacts_with_replies(limit=100)
        if err:
            print(f"[ReplyDetector] Error querying replies: {err}")
            return []

        print(f"[ReplyDetector] Found {len(contacts)} contacts with new replies")
        return contacts


# ── Conversation Summary Generator ───────────────────────────────────────────

async def generate_conversation_summary(
    messages: list[dict[str, Any]],
    contact: dict[str, Any],
) -> dict[str, Any]:
    """
    Generate AI summary of conversation with sentiment analysis.

    Returns:
        Dict with keys: text, sentiment, recommended_response
    """
    if not messages:
        return {
            "text": "No conversation history available",
            "sentiment": "neutral",
            "recommended_response": "Review contact profile"
        }

    # Build conversation thread
    thread_lines = []
    for msg in messages[-10:]:  # Last 10 messages
        sender = "Me" if msg.get("is_outbound") else contact.get("display_name", "Them")
        text = msg.get("message_text", "")
        thread_lines.append(f"{sender}: {text}")

    thread = "\n".join(thread_lines)

    prompt = f"""Summarize this conversation in 2 sentences max.
Also assess:
- sentiment: (positive/neutral/objection/interested)
- recommended_response: Brief suggestion for how to respond

Return ONLY valid JSON with this structure:
{{"summary": "...", "sentiment": "...", "recommended_response": "..."}}

Thread:
{thread}
"""

    try:
        response = await call_claude(prompt, model="claude-haiku-4-5-20251001")

        # Parse JSON response
        # Try to extract JSON from response (handle markdown code blocks)
        response_clean = response.strip()
        if response_clean.startswith("```"):
            # Remove markdown code block
            lines = response_clean.split("\n")
            response_clean = "\n".join(lines[1:-1])

        result = json.loads(response_clean)

        return {
            "text": result.get("summary", "Conversation summary unavailable"),
            "sentiment": result.get("sentiment", "neutral"),
            "recommended_response": result.get("recommended_response", "Review conversation")
        }

    except Exception as e:
        print(f"[ConversationSummary] Error: {e}")
        return {
            "text": f"Recent message: {messages[-1].get('message_text', '')[:100]}",
            "sentiment": "neutral",
            "recommended_response": "Review full conversation"
        }


# ── Reply Handler ─────────────────────────────────────────────────────────────

async def handle_reply(contact: dict[str, Any], notif_client: NotificationClient):
    """
    Handle a prospect reply:
      1. Advance stage to 'replied'
      2. Cancel pending follow-ups
      3. Generate conversation summary
      4. Send human notification
    """
    contact_id = contact["id"]
    print(f"[ReplyHandler] Processing reply from {contact.get('display_name')} (ID: {contact_id})")

    # Step 1: Advance stage to 'replied'
    _, err = queries.update_pipeline_stage(contact_id, "replied", triggered_by="agent")
    if err:
        print(f"[ReplyHandler] Error updating stage: {err}")
        return

    # Step 2: Cancel pending follow-ups
    _, err = queries.cancel_pending_followups(contact_id)
    if err:
        print(f"[ReplyHandler] Error cancelling follow-ups: {err}")

    # Step 3: Generate conversation summary
    messages, err = queries.get_conversation_messages(contact_id, limit=10)
    if err:
        print(f"[ReplyHandler] Error fetching messages: {err}")
        messages = []

    summary = await generate_conversation_summary(messages, contact)

    # Step 4: Store notification
    notification = {
        "contact_id": contact_id,
        "trigger": "replied",
        "summary": summary["text"],
        "context_url": f"{config.SUPABASE_URL.replace('/rest/v1', '')}/contacts/{contact_id}",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    _, err = queries.insert_human_notification(notification)
    if err:
        print(f"[ReplyHandler] Error storing notification: {err}")

    # Step 5: Notify human
    await notif_client.notify_reply(contact, summary)

    print(f"[ReplyHandler] ✓ Reply processed for {contact.get('display_name')}")


# ── Follow-up Message Generator ──────────────────────────────────────────────

FOLLOWUP_PROMPTS = {
    2: """Write a follow-up DM (touch 2 of 3). They haven't replied to the first message.
Use a COMPLETELY different angle — lead with a specific result or data point.
2-3 sentences only. End with a yes/no question.
Original message was about: {original_message_topic}
Contact: {contact_brief}

Return ONLY the message text, no explanation.""",

    3: """Write a final follow-up DM. This is the LAST message you'll send.
1-2 sentences. Close the loop gracefully. Leave the door open without desperation.
Example pattern: "Last one from me — if [trigger event] ever changes, happy to share [value prop]."
Contact: {contact_brief}

Return ONLY the message text, no explanation."""
}


def build_contact_brief(contact: dict[str, Any]) -> str:
    """Build a brief contact description for Claude prompts."""
    platform = contact.get("platform", "unknown")
    handle = contact.get("handle", "unknown")
    bio = contact.get("bio", "")[:200]
    score = contact.get("relationship_score", 0)

    return f"Platform: {platform}, Handle: @{handle}, ICP Score: {score}/100, Bio: {bio}"


async def generate_followup(contact: dict[str, Any], touch_number: int) -> str:
    """
    Generate follow-up message using Claude.

    Args:
        contact: Contact record
        touch_number: 2 for first follow-up, 3 for final follow-up

    Returns:
        Generated follow-up message text
    """
    if touch_number not in FOLLOWUP_PROMPTS:
        raise ValueError(f"Invalid touch_number: {touch_number}")

    # Get original outreach message
    original, err = queries.get_first_outreach(contact["id"])
    if err or not original:
        original_topic = "your service offering"
    else:
        original_topic = original.get("message_text", "")[:100]

    contact_brief = build_contact_brief(contact)

    prompt = FOLLOWUP_PROMPTS[touch_number].format(
        original_message_topic=original_topic,
        contact_brief=contact_brief
    )

    try:
        message = await call_claude(prompt, model=config.CLAUDE_MODEL_GENERATION)
        return message.strip()
    except Exception as e:
        print(f"[FollowupGenerator] Error: {e}")
        # Fallback generic message
        if touch_number == 2:
            return "Following up on my last message. Quick question: would this be helpful for you right now?"
        else:
            return "Last one from me — if timing changes, feel free to reach out!"


# ── Follow-up Processor ───────────────────────────────────────────────────────

async def process_followups(dry_run: bool = False):
    """
    Process all pending follow-ups:
      - Day 4: First follow-up (contacted → follow_up_1)
      - Day 7: Second follow-up (follow_up_1 → follow_up_2)
      - Day 10: Archive (follow_up_2 → archived)
    """
    print("\n=== Processing Follow-ups ===\n")

    # Follow-up 1 (Day 4)
    print("[FollowUp1] Checking for contacts ready for first follow-up...")
    fu1_contacts, err = queries.get_stale_contacted(days=config.FOLLOWUP_1_DAYS, limit=50)
    if err:
        print(f"[FollowUp1] Error: {err}")
        fu1_contacts = []

    print(f"[FollowUp1] Found {len(fu1_contacts)} contacts ready for follow-up 1")

    for contact in fu1_contacts:
        contact_id = contact["id"]
        display_name = contact.get("display_name", "Unknown")

        print(f"[FollowUp1] Processing {display_name} (ID: {contact_id})")

        if dry_run:
            print(f"[FollowUp1] [DRY-RUN] Would generate follow-up 1 for {display_name}")
            continue

        # Generate message
        try:
            message = await generate_followup(contact, touch_number=2)
            print(f"[FollowUp1] Generated message: {message[:80]}...")

            # Schedule via outreach sequence
            sequence = {
                "contact_id": contact_id,
                "platform": contact.get("platform", "twitter"),
                "touch_number": 2,
                "message_text": message,
                "scheduled_at": datetime.now(timezone.utc).isoformat(),
                "status": "pending",
            }

            _, err = queries.insert_outreach_sequence(sequence)
            if err:
                print(f"[FollowUp1] Error scheduling: {err}")
                continue

            # Update stage
            _, err = queries.update_pipeline_stage(contact_id, "follow_up_1", triggered_by="agent")
            if err:
                print(f"[FollowUp1] Error updating stage: {err}")

            print(f"[FollowUp1] ✓ Scheduled follow-up 1 for {display_name}")

        except Exception as e:
            print(f"[FollowUp1] Exception for {display_name}: {e}")

    # Follow-up 2 (Day 7)
    print("\n[FollowUp2] Checking for contacts ready for second follow-up...")
    fu2_contacts, err = queries.get_stale_followup1(days=config.FOLLOWUP_2_DAYS - config.FOLLOWUP_1_DAYS, limit=50)
    if err:
        print(f"[FollowUp2] Error: {err}")
        fu2_contacts = []

    print(f"[FollowUp2] Found {len(fu2_contacts)} contacts ready for follow-up 2")

    for contact in fu2_contacts:
        contact_id = contact["id"]
        display_name = contact.get("display_name", "Unknown")

        print(f"[FollowUp2] Processing {display_name} (ID: {contact_id})")

        if dry_run:
            print(f"[FollowUp2] [DRY-RUN] Would generate follow-up 2 for {display_name}")
            continue

        # Generate message
        try:
            message = await generate_followup(contact, touch_number=3)
            print(f"[FollowUp2] Generated message: {message[:80]}...")

            # Schedule via outreach sequence
            sequence = {
                "contact_id": contact_id,
                "platform": contact.get("platform", "twitter"),
                "touch_number": 3,
                "message_text": message,
                "scheduled_at": datetime.now(timezone.utc).isoformat(),
                "status": "pending",
            }

            _, err = queries.insert_outreach_sequence(sequence)
            if err:
                print(f"[FollowUp2] Error scheduling: {err}")
                continue

            # Update stage
            _, err = queries.update_pipeline_stage(contact_id, "follow_up_2", triggered_by="agent")
            if err:
                print(f"[FollowUp2] Error updating stage: {err}")

            print(f"[FollowUp2] ✓ Scheduled follow-up 2 for {display_name}")

        except Exception as e:
            print(f"[FollowUp2] Exception for {display_name}: {e}")

    # Archive (Day 10+)
    print("\n[Archive] Checking for contacts ready for archival...")
    archive_contacts, err = queries.get_stale_followup2(days=config.ARCHIVE_DAYS - config.FOLLOWUP_2_DAYS, limit=50)
    if err:
        print(f"[Archive] Error: {err}")
        archive_contacts = []

    print(f"[Archive] Found {len(archive_contacts)} contacts ready for archival")

    for contact in archive_contacts:
        contact_id = contact["id"]
        display_name = contact.get("display_name", "Unknown")

        print(f"[Archive] Processing {display_name} (ID: {contact_id})")

        if dry_run:
            print(f"[Archive] [DRY-RUN] Would archive {display_name}")
            continue

        # Update stage to archived
        _, err = queries.update_pipeline_stage(contact_id, "archived", triggered_by="agent")
        if err:
            print(f"[Archive] Error updating stage: {err}")
            continue

        # Set archived_at timestamp
        _, err = queries.set_archived_at(contact_id)
        if err:
            print(f"[Archive] Error setting archived_at: {err}")

        # Record reason
        _, err = queries.insert_funnel_event(
            contact_id,
            "follow_up_2",
            "archived",
            "agent",
            metadata={"reason": "no_reply_after_sequence"}
        )

        print(f"[Archive] ✓ Archived {display_name}")

    print("\n=== Follow-up Processing Complete ===\n")


# ── CLI ───────────────────────────────────────────────────────────────────────

async def main():
    """Main CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="AAG Agent 06: Follow-up & Human Notification Agent")
    parser.add_argument("--process", action="store_true", help="Full cycle: sync + detect replies + send follow-ups")
    parser.add_argument("--show-pending", action="store_true", help="Show contacts pending follow-ups")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen without taking action")

    args = parser.parse_args()

    if not any([args.process, args.show_pending, args.dry_run]):
        parser.print_help()
        sys.exit(1)

    notif_client = NotificationClient()
    reply_detector = ReplyDetector()

    if args.process or args.dry_run:
        # Step 1: Detect replies
        print("\n=== Detecting Replies ===\n")
        replied_contacts = await reply_detector.sync_and_detect()

        if replied_contacts:
            print(f"\nProcessing {len(replied_contacts)} replies...")
            for contact in replied_contacts:
                if args.dry_run:
                    print(f"[DRY-RUN] Would process reply from {contact.get('display_name')}")
                else:
                    await handle_reply(contact, notif_client)
        else:
            print("No new replies detected.\n")

        # Step 2: Process follow-ups
        await process_followups(dry_run=args.dry_run)

    if args.show_pending:
        print("\n=== Pending Follow-ups ===\n")

        # Show contacts ready for follow-up 1
        fu1_contacts, _ = queries.get_stale_contacted(days=config.FOLLOWUP_1_DAYS, limit=50)
        print(f"Follow-up 1 pending: {len(fu1_contacts)}")
        for c in fu1_contacts[:5]:
            print(f"  - {c.get('display_name')} (@{c.get('handle')}) on {c.get('platform')}")

        # Show contacts ready for follow-up 2
        fu2_contacts, _ = queries.get_stale_followup1(days=config.FOLLOWUP_2_DAYS - config.FOLLOWUP_1_DAYS, limit=50)
        print(f"\nFollow-up 2 pending: {len(fu2_contacts)}")
        for c in fu2_contacts[:5]:
            print(f"  - {c.get('display_name')} (@{c.get('handle')}) on {c.get('platform')}")

        # Show contacts ready for archival
        archive_contacts, _ = queries.get_stale_followup2(days=config.ARCHIVE_DAYS - config.FOLLOWUP_2_DAYS, limit=50)
        print(f"\nReady for archival: {len(archive_contacts)}")
        for c in archive_contacts[:5]:
            print(f"  - {c.get('display_name')} (@{c.get('handle')}) on {c.get('platform')}")

        print()


if __name__ == "__main__":
    asyncio.run(main())
