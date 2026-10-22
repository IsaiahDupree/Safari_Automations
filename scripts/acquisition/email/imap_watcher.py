"""IMAP inbox reader with explicit freshness and reply-link evidence.

This module deliberately does not equate an empty result with a successful
sync. Callers must inspect ``InboxSyncResult.ok`` before making no-reply
decisions.
"""
import email
import imaplib
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from email.utils import parsedate_to_datetime
from typing import Optional

from ..config import IMAP_HOST, IMAP_USER, IMAP_PASS

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailReply:
    from_email: str
    subject: str
    body: str
    received_at: datetime
    message_id: str
    in_reply_to: Optional[str] = None
    references: tuple[str, ...] = ()
    source_uid: Optional[str] = None


@dataclass(frozen=True)
class InboxSyncResult:
    ok: bool
    replies: tuple[EmailReply, ...]
    synced_at: datetime
    error: Optional[str] = None
    source: str = "imap"


def _message_ids(value: Optional[str]) -> set[str]:
    """Normalize RFC Message-ID list fields while preserving their exact IDs."""
    import re
    return set(re.findall(r"<[^>]+>", value or ""))


class IMAPWatcher:
    """Fetch recent inbox messages and report transport health explicitly."""

    def __init__(self, host: Optional[str] = None, user: Optional[str] = None,
                 password: Optional[str] = None):
        self.host = host or IMAP_HOST
        self.user = user or IMAP_USER
        self.password = password or IMAP_PASS
        if not all((self.host, self.user, self.password)):
            raise ValueError("IMAP credentials required (IMAP_HOST, IMAP_USER, IMAP_PASS)")

    def fetch_new_replies(self, since_date: Optional[datetime] = None) -> InboxSyncResult:
        """Fetch inbox mail since date; a failed fetch returns ``ok=False``."""
        since_date = since_date or (datetime.now(timezone.utc) - timedelta(days=7))
        replies: list[EmailReply] = []
        try:
            with imaplib.IMAP4_SSL(self.host) as mail:
                mail.login(self.user, self.password)
                status, _ = mail.select("INBOX", readonly=True)
                if status != "OK":
                    raise RuntimeError("IMAP could not select INBOX")
                status, data = mail.search(None, "SINCE", since_date.strftime("%d-%b-%Y"))
                if status != "OK":
                    raise RuntimeError("IMAP inbox search failed")
                for uid in data[0].split():
                    status, msg_data = mail.fetch(uid, "(RFC822)")
                    if status != "OK" or not msg_data or not isinstance(msg_data[0], tuple):
                        raise RuntimeError(f"IMAP fetch failed for message {uid.decode(errors='replace')}")
                    parsed = self._parse_email(email.message_from_bytes(msg_data[0][1]), uid.decode())
                    if parsed:
                        replies.append(parsed)
            return InboxSyncResult(True, tuple(replies), datetime.now(timezone.utc))
        except Exception as exc:
            logger.exception("IMAP inbox sync failed")
            return InboxSyncResult(False, tuple(), datetime.now(timezone.utc), str(exc))

    def _parse_email(self, msg: email.message.Message, source_uid: Optional[str] = None) -> Optional[EmailReply]:
        from_email = self._extract_email(str(msg.get("From", "")))
        if not from_email:
            return None
        try:
            received_at = parsedate_to_datetime(str(msg.get("Date", "")))
            if received_at.tzinfo is None:
                received_at = received_at.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError, OverflowError):
            received_at = datetime.now(timezone.utc)
        return EmailReply(
            from_email=from_email.lower(),
            subject=self._decode_header(str(msg.get("Subject", ""))),
            body=self._get_body(msg),
            received_at=received_at,
            message_id=str(msg.get("Message-ID", "")).strip(),
            in_reply_to=(next(iter(_message_ids(str(msg.get("In-Reply-To", "")))), None)),
            references=tuple(sorted(_message_ids(str(msg.get("References", ""))))),
            source_uid=source_uid,
        )

    @staticmethod
    def _extract_email(from_header: str) -> str:
        from email.utils import parseaddr
        return parseaddr(from_header)[1]

    @staticmethod
    def _decode_header(header: str) -> str:
        parts = []
        for content, encoding in decode_header(header):
            parts.append(content.decode(encoding or "utf-8", errors="replace") if isinstance(content, bytes) else content)
        return "".join(parts)

    @staticmethod
    def _get_body(msg: email.message.Message) -> str:
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain" and part.get_content_disposition() != "attachment":
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or "utf-8"
                        return payload.decode(charset, errors="replace").strip()
            return ""
        payload = msg.get_payload(decode=True)
        if not payload:
            return ""
        return payload.decode(msg.get_content_charset() or "utf-8", errors="replace").strip()


def assess_reply_link(message: EmailReply, outbound_message_ids: set[str],
                      outbound_subjects: set[str] = frozenset()) -> tuple[str, str]:
    """Return (classification, evidence); avoid claiming unrelated mail is a reply."""
    refs = set(message.references)
    if message.in_reply_to and message.in_reply_to in outbound_message_ids:
        return "human_reply", f"In-Reply-To matches outbound Message-ID {message.in_reply_to}"
    matched = refs.intersection(outbound_message_ids)
    if matched:
        return "human_reply", f"References matches outbound Message-ID {sorted(matched)[0]}"
    if message.subject.lower().removeprefix("re:").strip() in {
        subject.lower().removeprefix("re:").strip() for subject in outbound_subjects
    }:
        return "needs_review", "Subject matches an outbound message, but thread headers do not"
    return "unmatched", "No outbound message ID or subject evidence links this message"
