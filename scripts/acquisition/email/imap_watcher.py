"""
acquisition/email/imap_watcher.py — IMAP inbox watcher for reply detection.

Monitors inbox for replies to outreach emails and updates contact status.
"""
import imaplib
import email
from email.header import decode_header
from datetime import datetime, timezone
from typing import Optional, NamedTuple

from ..config import IMAP_HOST, IMAP_USER, IMAP_PASS


class EmailReply(NamedTuple):
    """Represents a detected reply."""

    from_email: str
    subject: str
    body: str
    received_at: datetime
    message_id: str


class IMAPWatcher:
    """
    Watch IMAP inbox for replies to outreach emails.

    Usage:
        watcher = IMAPWatcher()
        replies = await watcher.fetch_new_replies(since_date)
    """

    def __init__(
        self,
        host: Optional[str] = None,
        user: Optional[str] = None,
        password: Optional[str] = None,
    ):
        """
        Initialize IMAP watcher.

        Args:
            host: IMAP server hostname (defaults to IMAP_HOST env var)
            user: IMAP username (defaults to IMAP_USER env var)
            password: IMAP password (defaults to IMAP_PASS env var)
        """
        self.host = host or IMAP_HOST
        self.user = user or IMAP_USER
        self.password = password or IMAP_PASS

        if not all([self.host, self.user, self.password]):
            raise ValueError("IMAP credentials required (IMAP_HOST, IMAP_USER, IMAP_PASS)")

    def fetch_new_replies(self, since_date: Optional[datetime] = None) -> list[EmailReply]:
        """
        Fetch new replies from inbox.

        Args:
            since_date: Only fetch emails since this date (default: last 7 days)

        Returns:
            List of EmailReply objects
        """
        if not since_date:
            # Default to last 7 days
            from datetime import timedelta
            since_date = datetime.now(timezone.utc) - timedelta(days=7)

        replies = []

        try:
            # Connect to IMAP server
            with imaplib.IMAP4_SSL(self.host) as mail:
                mail.login(self.user, self.password)
                mail.select("INBOX")

                # Build search criteria
                date_str = since_date.strftime("%d-%b-%Y")
                search_criteria = f'(SINCE {date_str})'

                # Search for emails
                _, message_numbers = mail.search(None, search_criteria)

                for num in message_numbers[0].split():
                    # Fetch email
                    _, msg_data = mail.fetch(num, "(RFC822)")

                    # Parse email
                    email_body = msg_data[0][1]
                    msg = email.message_from_bytes(email_body)

                    # Extract details
                    reply = self._parse_email(msg)
                    if reply:
                        replies.append(reply)

        except Exception as e:
            # Log error but don't crash
            print(f"IMAP fetch error: {e}")
            return []

        return replies

    def _parse_email(self, msg: email.message.Message) -> Optional[EmailReply]:
        """
        Parse email message to EmailReply.

        Args:
            msg: Email message object

        Returns:
            EmailReply if successfully parsed, None otherwise
        """
        try:
            # Extract from address
            from_header = msg.get("From", "")
            from_email = self._extract_email(from_header)

            # Extract subject
            subject_header = msg.get("Subject", "")
            subject = self._decode_header(subject_header)

            # Extract date
            date_str = msg.get("Date", "")
            received_at = self._parse_date(date_str)

            # Extract message ID
            message_id = msg.get("Message-ID", "")

            # Extract body
            body = self._get_body(msg)

            if not from_email:
                return None

            return EmailReply(
                from_email=from_email,
                subject=subject,
                body=body,
                received_at=received_at,
                message_id=message_id,
            )

        except Exception:
            return None

    def _extract_email(self, from_header: str) -> str:
        """Extract email address from From header."""
        import re

        match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", from_header)
        return match.group(0) if match else ""

    def _decode_header(self, header: str) -> str:
        """Decode email header."""
        decoded = decode_header(header)
        parts = []

        for content, encoding in decoded:
            if isinstance(content, bytes):
                parts.append(content.decode(encoding or "utf-8", errors="ignore"))
            else:
                parts.append(content)

        return "".join(parts)

    def _parse_date(self, date_str: str) -> datetime:
        """Parse email date to datetime."""
        try:
            from email.utils import parsedate_to_datetime

            return parsedate_to_datetime(date_str)
        except Exception:
            return datetime.now(timezone.utc)

    def _get_body(self, msg: email.message.Message) -> str:
        """Extract email body (prefer plain text)."""
        body = ""

        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == "text/plain":
                    payload = part.get_payload(decode=True)
                    if payload:
                        body = payload.decode("utf-8", errors="ignore")
                        break
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                body = payload.decode("utf-8", errors="ignore")

        return body.strip()
