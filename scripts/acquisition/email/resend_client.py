"""
acquisition/email/resend_client.py — Resend API client for transactional emails.

Handles email sending with rate limiting, error handling, and bounce tracking.
"""
import httpx
from typing import Optional

from ..config import RESEND_API_KEY, FROM_EMAIL


class ResendError(Exception):
    """Base exception for Resend client errors."""
    pass


class InvalidEmailError(ResendError):
    """Raised when email address is invalid (422)."""

    def __init__(self, email: str):
        self.email = email
        super().__init__(f"Invalid email address: {email}")


class RateLimitError(ResendError):
    """Raised when rate limit is hit (429)."""

    def __init__(self, service: str, retry_after: int = 60):
        self.service = service
        self.retry_after = retry_after
        super().__init__(f"Rate limit exceeded for {service}, retry after {retry_after}s")


class ResendClient:
    """
    Async client for Resend transactional email API.

    Usage:
        client = ResendClient()
        result = await client.send_email(
            to="user@example.com",
            subject="Welcome!",
            html="<p>Hello!</p>",
            text="Hello!"
        )
    """

    BASE_URL = "https://api.resend.com"

    def __init__(self, api_key: Optional[str] = None, from_email: Optional[str] = None):
        """
        Initialize Resend client.

        Args:
            api_key: Resend API key (defaults to RESEND_API_KEY env var)
            from_email: Default from email (defaults to FROM_EMAIL env var)
        """
        self.api_key = api_key or RESEND_API_KEY
        self.from_email = from_email or FROM_EMAIL

        if not self.api_key:
            raise ValueError("RESEND_API_KEY is required")
        if not self.from_email:
            raise ValueError("FROM_EMAIL is required")

    async def send_email(
        self,
        to: str,
        subject: str,
        html: str,
        text: str,
        reply_to: Optional[str] = None,
    ) -> dict:
        """
        Send an email via Resend API.

        Args:
            to: Recipient email address
            subject: Email subject line
            html: HTML email body
            text: Plain text email body
            reply_to: Optional reply-to address

        Returns:
            Dict with Resend response: {"id": "resend_message_id"}

        Raises:
            InvalidEmailError: If email address is invalid (422)
            RateLimitError: If rate limit exceeded (429)
            ResendError: For other API errors
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {
                "from": self.from_email,
                "to": [to],
                "subject": subject,
                "html": html,
                "text": text,
            }

            if reply_to:
                payload["reply_to"] = [reply_to]

            try:
                response = await client.post(
                    f"{self.BASE_URL}/emails",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json=payload,
                )

                # Handle specific error codes
                if response.status_code == 422:
                    raise InvalidEmailError(to)

                if response.status_code == 429:
                    # Check for retry-after header
                    retry_after = int(response.headers.get("retry-after", 60))
                    raise RateLimitError("resend", retry_after=retry_after)

                # Raise for other HTTP errors
                response.raise_for_status()

                return response.json()

            except httpx.HTTPError as e:
                if not isinstance(e, (InvalidEmailError, RateLimitError)):
                    raise ResendError(f"HTTP error: {str(e)}")
                raise

    async def get_email(self, resend_id: str) -> dict:
        """
        Get email details by Resend ID.

        Args:
            resend_id: Resend message ID

        Returns:
            Dict with email details including status

        Raises:
            ResendError: For API errors
        """
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(
                    f"{self.BASE_URL}/emails/{resend_id}",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                response.raise_for_status()
                return response.json()

            except httpx.HTTPError as e:
                raise ResendError(f"Failed to get email {resend_id}: {str(e)}")
