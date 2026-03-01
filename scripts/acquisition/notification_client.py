"""
acquisition/notification_client.py — Human notification delivery system.

Sends push notifications (via macOS Notification Center) and email notifications
(via Mail.app) when prospects reply or require human intervention.
"""
import asyncio
import subprocess
from typing import Any, Optional
from datetime import datetime

from .config import OWNER_EMAIL, SUPABASE_URL


class NotificationClient:
    """Delivers human notifications via push notifications and email."""

    def __init__(self, owner_email: str = OWNER_EMAIL):
        self.owner_email = owner_email

    async def notify_reply(
        self,
        contact: dict[str, Any],
        summary: dict[str, Any],
    ) -> tuple[bool, bool]:
        """
        Send both push notification and email when prospect replies.

        Args:
            contact: Contact record with id, display_name, handle, platform
            summary: Summary dict with text, sentiment, recommended_response

        Returns:
            Tuple of (push_sent, email_sent) booleans
        """
        push_sent = await self.send_push(contact, summary)
        email_sent = await self.send_email(contact, summary)
        return push_sent, email_sent

    async def send_push(
        self,
        contact: dict[str, Any],
        summary: dict[str, Any],
    ) -> bool:
        """
        Send macOS push notification via AppleScript.

        Returns:
            True if notification was sent successfully
        """
        try:
            display_name = contact.get("display_name", "Unknown")
            platform = contact.get("platform", "").upper()
            summary_text = summary.get("text", "New reply received")

            # Escape quotes and special characters for AppleScript
            summary_escaped = summary_text.replace('"', '\\"').replace("'", "\\'")
            title_escaped = f"Reply from {display_name}".replace('"', '\\"')

            script = f'''
            display notification "{summary_escaped} — {platform}" ¬
                with title "{title_escaped}" ¬
                sound name "default"
            '''

            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=5
            )

            return result.returncode == 0

        except Exception as e:
            print(f"[NotificationClient] Push notification failed: {e}")
            return False

    async def send_email(
        self,
        contact: dict[str, Any],
        summary: dict[str, Any],
    ) -> bool:
        """
        Send email notification via Mail.app using AppleScript.

        Returns:
            True if email was composed successfully
        """
        if not self.owner_email:
            print("[NotificationClient] No owner email configured, skipping email notification")
            return False

        try:
            display_name = contact.get("display_name", "Unknown")
            handle = contact.get("handle", "")
            platform = contact.get("platform", "").upper()
            contact_id = contact.get("id", "")
            relationship_score = contact.get("relationship_score", 0)

            summary_text = summary.get("text", "New reply received")
            sentiment = summary.get("sentiment", "neutral")
            recommended_response = summary.get("recommended_response", "Review conversation for context")

            subject = f"[CRM] {display_name} replied on {platform}"

            body = f"""New reply detected from {display_name} (@{handle}) on {platform}.

SUMMARY: {summary_text}
SENTIMENT: {sentiment}
RECOMMENDED RESPONSE: {recommended_response}

ICP Score: {relationship_score}/100
Platform: {platform}
CRM Link: {SUPABASE_URL.replace('/rest/v1', '')}/contacts/{contact_id}

---
This is an automated notification from your acquisition pipeline.
"""

            # Escape for AppleScript
            subject_escaped = subject.replace('"', '\\"').replace('\n', ' ')
            body_escaped = body.replace('"', '\\"').replace('\n', '\\n')
            email_escaped = self.owner_email.replace('"', '\\"')

            script = f'''
            tell application "Mail"
                set newMessage to make new outgoing message with properties {{subject:"{subject_escaped}", content:"{body_escaped}", visible:true}}
                tell newMessage
                    make new to recipient at end of to recipients with properties {{address:"{email_escaped}"}}
                end tell
            end tell
            '''

            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=10
            )

            return result.returncode == 0

        except Exception as e:
            print(f"[NotificationClient] Email notification failed: {e}")
            return False

    async def notify_high_priority_prospect(
        self,
        contact: dict[str, Any],
        reason: str,
    ) -> tuple[bool, bool]:
        """
        Send notification for high-priority prospects (e.g., high ICP score).

        Args:
            contact: Contact record
            reason: Why this prospect is high priority

        Returns:
            Tuple of (push_sent, email_sent)
        """
        summary = {
            "text": f"High-priority prospect detected: {reason}",
            "sentiment": "positive",
            "recommended_response": "Review prospect profile and consider personalized outreach"
        }
        return await self.notify_reply(contact, summary)


# Async testing helpers
async def test_push_notification():
    """Test push notification delivery."""
    client = NotificationClient()
    test_contact = {
        "id": "test-123",
        "display_name": "Test User",
        "handle": "testuser",
        "platform": "twitter",
        "relationship_score": 85,
    }
    test_summary = {
        "text": "This is a test notification from the acquisition pipeline",
        "sentiment": "positive",
        "recommended_response": "Test successful - no action needed"
    }

    push_sent = await client.send_push(test_contact, test_summary)
    print(f"Push notification sent: {push_sent}")
    return push_sent


async def test_email_notification():
    """Test email notification delivery."""
    client = NotificationClient()
    test_contact = {
        "id": "test-123",
        "display_name": "Test User",
        "handle": "testuser",
        "platform": "twitter",
        "relationship_score": 85,
    }
    test_summary = {
        "text": "This is a test email notification from the acquisition pipeline",
        "sentiment": "positive",
        "recommended_response": "Test successful - no action needed"
    }

    email_sent = await client.send_email(test_contact, test_summary)
    print(f"Email notification sent: {email_sent}")
    return email_sent


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--test-push":
        asyncio.run(test_push_notification())
    elif len(sys.argv) > 1 and sys.argv[1] == "--test-email":
        asyncio.run(test_email_notification())
    else:
        print("Usage:")
        print("  python -m acquisition.notification_client --test-push")
        print("  python -m acquisition.notification_client --test-email")
