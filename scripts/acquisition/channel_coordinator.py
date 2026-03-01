"""
acquisition/channel_coordinator.py — Channel Coordination Logic

Ensures only one active outreach channel per contact at a time.
Manages transitions between DM and email channels based on contact
responses and engagement patterns.
"""
import sys
import os
from typing import Optional, Literal
from datetime import datetime, timezone, timedelta

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from acquisition.db import queries


ChannelType = Literal["dm", "email", "none"]


class ChannelCoordinator:
    """
    Coordinates outreach channels (DM vs Email) to prevent conflicts.

    Rules:
    1. LinkedIn contacts with email → prefer 'email' channel
    2. Other platforms → prefer 'dm' channel
    3. If DM sequence is active → block email
    4. If email sequence is active → block DM
    5. If contact replies to DM → pause email sequence
    6. If contact replies to email → cancel DM sequence
    7. After DM archived (no reply for 10 days) → switch to email
    """

    @staticmethod
    def get_active_channel(contact: dict) -> ChannelType:
        """
        Determine the active outreach channel for a contact.

        Returns:
            - "dm": DM channel is active
            - "email": Email channel is active
            - "none": No active channel
        """
        platform = contact.get("primary_platform", "")
        has_email = bool(contact.get("email"))
        pipeline_stage = contact.get("pipeline_stage", "")

        # Check if contact has replied (either channel)
        if pipeline_stage == "replied":
            return "none"  # Human should take over

        # LinkedIn with email → prefer email
        if platform == "linkedin" and has_email:
            return ChannelCoordinator._check_active_sequences(contact, prefer="email")

        # Other platforms → prefer DM
        return ChannelCoordinator._check_active_sequences(contact, prefer="dm")

    @staticmethod
    def _check_active_sequences(contact: dict, prefer: ChannelType = "dm") -> ChannelType:
        """
        Check which sequences are active for this contact.

        If both are active (shouldn't happen), return the preferred one.
        If neither is active, return the preferred one.
        """
        contact_id = contact["id"]

        # Check DM sequences
        dm_active = ChannelCoordinator._has_active_dm_sequence(contact_id)

        # Check email sequences
        email_active = ChannelCoordinator._has_active_email_sequence(contact_id)

        # Both active → prefer the specified one
        if dm_active and email_active:
            print(f"⚠️  Both DM and email active for {contact_id}, preferring {prefer}")
            return prefer

        # One is active
        if dm_active:
            return "dm"
        if email_active:
            return "email"

        # Neither active → use preference
        return prefer

    @staticmethod
    def _has_active_dm_sequence(contact_id: str) -> bool:
        """Check if contact has an active DM sequence."""
        # Query for non-archived outreach sequences
        sequences, err = queries._select(
            "acq_outreach_sequences",
            f"?contact_id=eq.{contact_id}&status=neq.archived&limit=1"
        )
        if err:
            return False
        return len(sequences) > 0

    @staticmethod
    def _has_active_email_sequence(contact_id: str) -> bool:
        """Check if contact has an active email sequence."""
        # Query for non-archived email sequences
        sequences, err = queries._select(
            "acq_email_sequences",
            f"?contact_id=eq.{contact_id}&status=neq.archived&limit=1"
        )
        if err:
            return False
        return len(sequences) > 0

    @staticmethod
    def pause_email_if_dm_replied(contact_id: str) -> bool:
        """
        Pause email sequences if contact replied to DM.

        Returns:
            True if email sequences were paused, False otherwise
        """
        # Archive all pending/sent email sequences
        result, err = queries._update(
            "acq_email_sequences",
            f"?contact_id=eq.{contact_id}&status=neq.archived",
            {"status": "archived", "archived_reason": "dm_replied"}
        )
        if err:
            print(f"❌ Failed to pause email for {contact_id}: {err}")
            return False

        print(f"✅ Paused email sequences for {contact_id} (DM reply)")
        return True

    @staticmethod
    def cancel_dm_if_email_replied(contact_id: str) -> bool:
        """
        Cancel DM sequences if contact replied to email.

        Returns:
            True if DM sequences were cancelled, False otherwise
        """
        # Archive all pending/sent DM sequences
        result, err = queries._update(
            "acq_outreach_sequences",
            f"?contact_id=eq.{contact_id}&status=neq.archived",
            {"status": "archived", "archived_reason": "email_replied"}
        )
        if err:
            print(f"❌ Failed to cancel DM for {contact_id}: {err}")
            return False

        print(f"✅ Cancelled DM sequences for {contact_id} (email reply)")
        return True

    @staticmethod
    def should_switch_to_email(contact: dict) -> bool:
        """
        Determine if we should switch from DM to email channel.

        Switch conditions:
        1. DM sequence is archived (no reply)
        2. Contact has a verified email
        3. Contact is not in 'replied' or later stage
        4. At least 10 days since last DM

        Returns:
            True if we should switch to email, False otherwise
        """
        contact_id = contact["id"]
        pipeline_stage = contact.get("pipeline_stage", "")
        has_email = bool(contact.get("email"))

        # Must have email
        if not has_email:
            return False

        # Must not be in advanced stages
        if pipeline_stage in ["replied", "call_booked", "closed_won", "closed_lost"]:
            return False

        # Check if DM sequence is archived
        if not ChannelCoordinator._is_dm_sequence_archived(contact_id):
            return False

        # Check time since last DM
        last_dm_at = ChannelCoordinator._get_last_dm_timestamp(contact_id)
        if not last_dm_at:
            return False

        days_since_dm = (datetime.now(timezone.utc) - last_dm_at).days
        if days_since_dm < 10:
            return False

        return True

    @staticmethod
    def _is_dm_sequence_archived(contact_id: str) -> bool:
        """Check if all DM sequences for contact are archived."""
        # Query for non-archived sequences
        sequences, err = queries._select(
            "acq_outreach_sequences",
            f"?contact_id=eq.{contact_id}&status=neq.archived&limit=1"
        )
        if err:
            return False
        return len(sequences) == 0  # All archived if none are active

    @staticmethod
    def _get_last_dm_timestamp(contact_id: str) -> Optional[datetime]:
        """Get timestamp of last DM sent to contact."""
        sequences, err = queries._select(
            "acq_outreach_sequences",
            f"?contact_id=eq.{contact_id}&status=eq.sent&order=sent_at.desc&limit=1"
        )
        if err or not sequences:
            return None

        sent_at_str = sequences[0].get("sent_at")
        if not sent_at_str:
            return None

        try:
            return datetime.fromisoformat(sent_at_str.replace("Z", "+00:00"))
        except Exception:
            return None

    @staticmethod
    def block_outreach(contact_id: str, reason: str) -> bool:
        """
        Block all outreach to a contact (emergency stop).

        Archives all pending sequences and marks contact.

        Args:
            contact_id: Contact to block
            reason: Reason for blocking (e.g., "unsubscribed", "complained", "bounced")

        Returns:
            True if successful, False otherwise
        """
        # Archive DM sequences
        queries._update(
            "acq_outreach_sequences",
            f"?contact_id=eq.{contact_id}&status=neq.archived",
            {"status": "archived", "archived_reason": reason}
        )

        # Archive email sequences
        queries._update(
            "acq_email_sequences",
            f"?contact_id=eq.{contact_id}&status=neq.archived",
            {"status": "archived", "archived_reason": reason}
        )

        # Update contact stage to archived
        queries.update_pipeline_stage(contact_id, "archived", "channel_coordinator")

        print(f"🚫 Blocked all outreach to {contact_id}: {reason}")
        return True


# ══════════════════════════════════════════════════════════════════════════════
# Usage Examples
# ══════════════════════════════════════════════════════════════════════════════

def example_usage():
    """Example usage of ChannelCoordinator."""

    # Example contact
    contact = {
        "id": "contact_123",
        "display_name": "Jane Doe",
        "primary_platform": "linkedin",
        "email": "jane@example.com",
        "pipeline_stage": "contacted",
    }

    # Check active channel
    coordinator = ChannelCoordinator()
    active_channel = coordinator.get_active_channel(contact)
    print(f"Active channel: {active_channel}")

    # Handle DM reply
    if active_channel == "dm":
        coordinator.pause_email_if_dm_replied(contact["id"])

    # Handle email reply
    if active_channel == "email":
        coordinator.cancel_dm_if_email_replied(contact["id"])

    # Check if should switch to email
    if coordinator.should_switch_to_email(contact):
        print("✅ Should switch to email channel")

    # Emergency block
    coordinator.block_outreach(contact["id"], "unsubscribed")


if __name__ == "__main__":
    example_usage()
