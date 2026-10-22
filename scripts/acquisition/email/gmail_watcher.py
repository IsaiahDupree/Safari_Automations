"""Read-only Gmail API adapter using ACTP's existing owner OAuth token."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from .imap_watcher import EmailReply, InboxSyncResult, _message_ids


class GmailWatcher:
    """Fetch inbox messages through the already-authorized Gmail OAuth client."""

    def __init__(self):
        import sys
        from pathlib import Path

        worker_root = Path(__file__).resolve().parents[4] / "actp-worker"
        if not worker_root.is_dir():
            raise ValueError("ACTP Gmail client is unavailable")
        if str(worker_root) not in sys.path:
            sys.path.insert(0, str(worker_root))
        import gmail_client
        self.client = gmail_client

    def fetch_new_replies(self, since_date: Optional[datetime] = None,
                          sender_emails: Optional[list[str]] = None) -> InboxSyncResult:
        since_date = since_date or (datetime.now(timezone.utc) - timedelta(days=30))
        synced_at = datetime.now(timezone.utc)
        try:
            if not self.client._GOOGLE_AVAILABLE:
                raise RuntimeError("Google API client dependencies are unavailable")
            credentials = self.client.Credentials.from_authorized_user_file(
                self.client.GMAIL_TOKEN_FILE, self.client.GMAIL_SCOPES,
            )
            if not credentials.valid:
                if not credentials.expired or not credentials.refresh_token:
                    raise RuntimeError("Gmail OAuth token is invalid; owner reauthorization is required")
                from google.auth.transport.requests import Request
                credentials.refresh(Request(timeout=15))
                self.client._save_credentials(credentials)
            import httpx
            headers = {"Authorization": f"Bearer {credentials.token}"}
            api = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
            after = int(since_date.timestamp())
            senders = sorted({email.strip().lower() for email in (sender_emails or []) if email.strip()})
            if not senders:
                return InboxSyncResult(True, tuple(), synced_at, source="gmail")
            sender_filter = "{" + " ".join(f"from:{email}" for email in senders) + "}"
            query = f"in:inbox after:{after} {sender_filter}"
            replies = []
            with httpx.Client(timeout=15.0, headers=headers) as client:
                page_token = None
                for _ in range(10):  # Bounded to 5,000 messages per manual sync.
                    params = {"q": query, "maxResults": 500}
                    if page_token:
                        params["pageToken"] = page_token
                    response = client.get(api, params=params)
                    response.raise_for_status()
                    page = response.json()
                    for item in page.get("messages", []):
                        message_response = client.get(f"{api}/{item['id']}", params={"format": "full"})
                        message_response.raise_for_status()
                        raw = message_response.json()
                        if "SENT" in raw.get("labelIds", []):
                            continue
                        message_headers = {h["name"].lower(): h["value"]
                                           for h in raw.get("payload", {}).get("headers", [])}
                        parsed = self.client._parse_message(raw)
                        sender = parsed.from_email.lower()
                        if not sender:
                            continue
                        try:
                            received = datetime.fromtimestamp(int(raw.get("internalDate", 0)) / 1000, timezone.utc)
                        except (TypeError, ValueError, OSError):
                            received = datetime.fromisoformat(parsed.received_at.replace("Z", "+00:00"))
                        replies.append(EmailReply(
                            from_email=sender,
                            subject=parsed.subject,
                            body=parsed.body_text,
                            received_at=received,
                            message_id=next(iter(_message_ids(message_headers.get("message-id"))), ""),
                            in_reply_to=next(iter(_message_ids(message_headers.get("in-reply-to"))), None),
                            references=tuple(sorted(_message_ids(message_headers.get("references")))),
                            source_uid=parsed.gmail_message_id,
                        ))
                    page_token = page.get("nextPageToken")
                    if not page_token:
                        break
            return InboxSyncResult(True, tuple(replies), synced_at, source="gmail")
        except Exception as exc:
            return InboxSyncResult(False, tuple(), datetime.now(timezone.utc), str(exc), "gmail")
