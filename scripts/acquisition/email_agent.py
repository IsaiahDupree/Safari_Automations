"""
acquisition/email_agent.py — AAG Agent 08: Email Outreach Integration.

Orchestrates the complete email outreach pipeline:
1. Email discovery from multiple sources
2. Email verification
3. Claude-generated 3-touch sequences
4. Resend API sending with tracking
5. Reply detection via IMAP

Daily schedule:
- 7:30 AM: Email discovery for qualified contacts
- 9:30 AM: Send scheduled emails (up to 30/day)
- Every 4h: Check for replies via IMAP
"""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from .db import queries
from .email.resend_client import ResendClient, InvalidEmailError, RateLimitError
from .email.discovery import (
    extract_linkedin_email,
    scrape_website_email,
    guess_emails,
    search_email_perplexity,
    verify_email,
    EmailCandidate,
)
from .email.generator import EmailGenerator
from .config import FROM_EMAIL


class EmailAgent:
    """
    Email outreach agent for autonomous acquisition.

    Handles the complete email workflow from discovery to sending.
    """

    def __init__(self):
        """Initialize email agent with clients."""
        self.resend = ResendClient()
        self.generator = EmailGenerator()

    async def discover_emails(self, limit: int = 20, dry_run: bool = False) -> dict:
        """
        Discover and verify emails for qualified contacts without emails.

        Process:
        1. Get qualified contacts without verified emails
        2. Try discovery sources in priority order
        3. Verify discovered emails
        4. Save to acq_email_discoveries

        Args:
            limit: Max contacts to process
            dry_run: If True, don't save discoveries

        Returns:
            Stats dict with counts
        """
        stats = {
            "processed": 0,
            "linkedin": 0,
            "website": 0,
            "pattern": 0,
            "perplexity": 0,
            "verified": 0,
            "saved": 0,
        }

        # Get qualified contacts without verified emails
        contacts, err = queries.get_qualified_contacts(limit=limit)
        if err:
            return {"error": err}

        for contact in contacts:
            # Skip if we already have a verified email
            if contact.get("email_verified"):
                continue

            contact_id = contact["id"]
            stats["processed"] += 1

            candidates: list[EmailCandidate] = []

            # Source 1: LinkedIn (if available)
            if contact.get("linkedin_url"):
                email = await extract_linkedin_email(contact["linkedin_url"])
                if email:
                    candidates.append(
                        EmailCandidate(
                            email=email, source="linkedin", confidence=0.9, verified=False
                        )
                    )
                    stats["linkedin"] += 1

            # Source 2: Website scraping (if available)
            if contact.get("website_url") and not candidates:
                email = await scrape_website_email(contact["website_url"])
                if email:
                    candidates.append(
                        EmailCandidate(
                            email=email, source="website", confidence=0.8, verified=False
                        )
                    )
                    stats["website"] += 1

            # Source 3: Pattern guessing (if we have name + domain)
            if not candidates and contact.get("display_name"):
                # Try to extract domain from website or LinkedIn
                domain = self._extract_domain(contact)
                if domain:
                    pattern_candidates = guess_emails(
                        contact["display_name"], domain
                    )
                    candidates.extend(pattern_candidates)
                    if pattern_candidates:
                        stats["pattern"] += 1

            # Source 4: Perplexity search (last resort)
            if not candidates and contact.get("display_name"):
                email = await search_email_perplexity(
                    contact["display_name"], contact.get("niche_label")
                )
                if email:
                    candidates.append(
                        EmailCandidate(
                            email=email,
                            source="perplexity",
                            confidence=0.6,
                            verified=False,
                        )
                    )
                    stats["perplexity"] += 1

            # Verify top candidates
            for candidate in candidates[:3]:  # Only verify top 3
                result = await verify_email(candidate.email)
                candidate.verified = result.verified
                candidate.mx_valid = result.mx_valid

                if result.verified:
                    stats["verified"] += 1

                    # Save discovery
                    if not dry_run:
                        discovery = {
                            "contact_id": contact_id,
                            "email": candidate.email,
                            "source": candidate.source,
                            "confidence": candidate.confidence,
                            "verified": candidate.verified,
                            "mx_valid": candidate.mx_valid,
                        }
                        _, err = queries.upsert_email_discovery(discovery)
                        if not err:
                            stats["saved"] += 1

                        # Update contact with verified email
                        _, _ = queries.update_contact_email(
                            contact_id, candidate.email, verified=True
                        )

                    # Stop after first verified email
                    break

        return stats

    async def schedule_sequences(
        self, limit: int = 20, service_slug: str = "ai-content-engine"
    ) -> dict:
        """
        Schedule 3-touch email sequences for contacts with verified emails.

        Creates Touch 1, 2, 3 schedules for contacts in ready_for_dm stage
        who have verified emails and prefer email channel.

        Args:
            limit: Max contacts to schedule
            service_slug: Service offering identifier

        Returns:
            Stats dict with counts
        """
        stats = {"processed": 0, "scheduled": 0, "errors": []}

        # Get contacts ready for outreach with verified emails
        contacts, err = queries.get_ready_for_dm(limit=limit)
        if err:
            return {"error": err}

        for contact in contacts:
            # Only schedule if:
            # 1. Has verified email
            # 2. Not opted out
            # 3. Doesn't already have sequences
            if not contact.get("email_verified"):
                continue
            if contact.get("email_opted_out"):
                continue

            contact_id = contact["id"]
            email = contact.get("email")

            # Check if sequences already exist
            existing, _ = queries.get_email_sequences_for_contact(contact_id)
            if existing:
                continue

            stats["processed"] += 1

            # Schedule 3 touches
            now = datetime.now(timezone.utc)

            schedules = [
                {"touch_number": 1, "scheduled_at": now},  # Immediate
                {
                    "touch_number": 2,
                    "scheduled_at": now + timedelta(days=4),
                },  # +4 days
                {
                    "touch_number": 3,
                    "scheduled_at": now + timedelta(days=11),
                },  # +7 more days
            ]

            for schedule in schedules:
                seq = {
                    "id": str(uuid.uuid4()),
                    "contact_id": contact_id,
                    "service_slug": service_slug,
                    "touch_number": schedule["touch_number"],
                    "subject": "",  # Will be generated at send time
                    "from_email": FROM_EMAIL,
                    "to_email": email,
                    "scheduled_at": schedule["scheduled_at"].isoformat(),
                    "status": "pending",
                }

                _, err = queries.insert_email_sequence(seq)
                if err:
                    stats["errors"].append(f"Contact {contact_id}: {err}")
                else:
                    stats["scheduled"] += 1

        return stats

    async def send_pending(self, limit: int = 30, dry_run: bool = False) -> dict:
        """
        Send pending email sequences (up to daily cap).

        Process:
        1. Get pending sequences (scheduled_at <= now)
        2. Check daily cap
        3. Generate email if not pre-generated
        4. Validate email content
        5. Send via Resend API
        6. Track send and update status

        Args:
            limit: Max emails to send (default 30, matches daily cap)
            dry_run: If True, don't actually send

        Returns:
            Stats dict with counts
        """
        stats = {
            "processed": 0,
            "sent": 0,
            "skipped_opted_out": 0,
            "skipped_daily_cap": 0,
            "skipped_invalid": 0,
            "errors": [],
        }

        # Get pending sequences
        sequences, err = queries.get_pending_email(limit=limit)
        if err:
            return {"error": err}

        for seq in sequences:
            seq_id = seq["id"]
            contact_id = seq["contact_id"]
            to_email = seq["to_email"]

            stats["processed"] += 1

            # Get contact details
            contact, err = queries.get_contact(contact_id)
            if err or not contact:
                stats["errors"].append(f"Contact {contact_id} not found")
                continue

            # Check if opted out
            if contact.get("email_opted_out"):
                _, _ = queries.update_email_status(
                    seq_id, "skipped", skip_reason="unsubscribed"
                )
                stats["skipped_opted_out"] += 1
                continue

            # Check daily cap
            cap_ok, err = queries.check_daily_cap("email", "email")
            if not cap_ok:
                _, _ = queries.update_email_status(
                    seq_id, "skipped", skip_reason="daily_cap"
                )
                stats["skipped_daily_cap"] += 1
                continue

            # Generate email if not pre-generated
            if not seq.get("body_html") or not seq.get("subject"):
                draft = await self.generator.generate(
                    contact=contact,
                    touch_number=seq["touch_number"],
                    service_slug=seq["service_slug"],
                    niche_label=contact.get("niche_label"),
                )

                # Validate
                if not draft.is_valid:
                    _, _ = queries.update_email_status(
                        seq_id,
                        "skipped",
                        skip_reason=f"validation: {draft.validation_errors}",
                    )
                    stats["skipped_invalid"] += 1
                    continue

                # Generate unsubscribe URL
                from .api.routes.email import generate_unsub_token

                unsub_token = generate_unsub_token(contact_id)
                unsub_url = f"https://yourdomain.com/api/acquisition/email/unsubscribe?token={unsub_token}"

                # Wrap with template
                body_html = self.generator.wrap_with_template(
                    draft.body_html,
                    unsub_url,
                    contact.get("niche_label", "creators"),
                )

                # Update sequence with generated content
                _, err = queries.update_email_draft(
                    seq_id, draft.subject, draft.body_text, body_html
                )
                if err:
                    stats["errors"].append(f"Failed to save draft {seq_id}: {err}")
                    continue

                seq["subject"] = draft.subject
                seq["body_text"] = draft.body_text
                seq["body_html"] = body_html

            # Send email (if not dry run)
            if not dry_run:
                try:
                    result = await self.resend.send_email(
                        to=to_email,
                        subject=seq["subject"],
                        html=seq["body_html"],
                        text=seq["body_text"],
                    )

                    resend_id = result.get("id")

                    # Update sequence status
                    _, err = queries.update_email_sent(seq_id, resend_id)
                    if err:
                        stats["errors"].append(f"Failed to update {seq_id}: {err}")

                    # Increment daily cap
                    _, _ = queries.increment_daily_cap("email", "email")

                    # Track in CRM messages
                    _, _ = queries.insert_crm_message(
                        contact_id=contact_id,
                        message_type="email",
                        is_outbound=True,
                        message_text=seq["body_text"],
                    )

                    stats["sent"] += 1

                except InvalidEmailError as e:
                    _, _ = queries.update_email_status(
                        seq_id, "failed", skip_reason=f"invalid_email: {e.email}"
                    )
                    stats["errors"].append(str(e))

                except RateLimitError as e:
                    _, _ = queries.update_email_status(
                        seq_id, "pending", skip_reason=f"rate_limit: retry in {e.retry_after}s"
                    )
                    stats["errors"].append(str(e))
                    break  # Stop sending to avoid more rate limit errors

                except Exception as e:
                    _, _ = queries.update_email_status(
                        seq_id, "failed", skip_reason=f"error: {str(e)[:200]}"
                    )
                    stats["errors"].append(f"Send failed {seq_id}: {str(e)[:100]}")

            else:
                stats["sent"] += 1  # Count as sent in dry run

        return stats

    def _extract_domain(self, contact: dict) -> Optional[str]:
        """
        Extract domain from contact's website or LinkedIn.

        Args:
            contact: Contact dict

        Returns:
            Domain string (e.g., "example.com") or None
        """
        import re
        from urllib.parse import urlparse

        # Try website URL first
        if contact.get("website_url"):
            try:
                parsed = urlparse(contact["website_url"])
                domain = parsed.netloc or parsed.path
                # Remove www. prefix
                domain = re.sub(r"^www\.", "", domain)
                if domain:
                    return domain
            except Exception:
                pass

        # Try LinkedIn (extract company domain if in URL)
        if contact.get("linkedin_url"):
            # This is a heuristic - LinkedIn URLs don't contain email domains
            # We'd need to scrape the company page for this
            pass

        return None


# ══════════════════════════════════════════════════════════════════════════════
# CLI Interface
# ══════════════════════════════════════════════════════════════════════════════


async def main():
    """CLI interface for email agent."""
    import sys

    if len(sys.argv) < 2:
        print("Usage: python -m acquisition.email_agent <command>")
        print("Commands:")
        print("  discover [limit] [--dry-run]  - Discover emails for contacts")
        print("  schedule [limit]              - Schedule 3-touch sequences")
        print("  send [limit] [--dry-run]      - Send pending emails")
        return

    command = sys.argv[1]
    agent = EmailAgent()

    if command == "discover":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        dry_run = "--dry-run" in sys.argv
        print(f"Discovering emails (limit={limit}, dry_run={dry_run})...")
        stats = await agent.discover_emails(limit=limit, dry_run=dry_run)
        print("Results:", stats)

    elif command == "schedule":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        print(f"Scheduling sequences (limit={limit})...")
        stats = await agent.schedule_sequences(limit=limit)
        print("Results:", stats)

    elif command == "send":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 30
        dry_run = "--dry-run" in sys.argv
        print(f"Sending emails (limit={limit}, dry_run={dry_run})...")
        stats = await agent.send_pending(limit=limit, dry_run=dry_run)
        print("Results:", stats)

    else:
        print(f"Unknown command: {command}")


if __name__ == "__main__":
    asyncio.run(main())
