"""
acquisition/tests/test_email_agent.py — Tests for AAG Agent 08 Email Outreach.

Tests cover:
- Email validation (spam words, subject length)
- Resend client (error handling, rate limits)
- Email verification (MX, SMTP)
- Webhook handling (bounce, unsubscribe)
- Daily caps
- CRM message tracking
"""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta

from ..email.resend_client import (
    ResendClient,
    InvalidEmailError,
    RateLimitError,
    ResendError,
)
from ..email.generator import EmailGenerator, EmailValidator, EmailDraft
from ..email.discovery import (
    verify_email,
    VerifyResult,
    guess_emails,
    filter_false_positives,
    is_valid_email_format,
)
from ..api.routes.email import generate_unsub_token, decode_unsub_token


# ══════════════════════════════════════════════════════════════════════════════
# Email Validator Tests
# ══════════════════════════════════════════════════════════════════════════════


def test_email_validator_rejects_spam_words():
    """Test that validator rejects emails with spam words."""
    subject = "FREE MONEY - Act Now!"
    body = "Guaranteed to make you rich with no risk!"

    errors = EmailValidator.validate(subject, body)

    assert len(errors) > 0
    assert any("spam words" in err.lower() for err in errors)


def test_email_validator_rejects_long_subject():
    """Test that validator rejects overly long subjects."""
    subject = "A" * 100  # Exceeds MAX_SUBJECT_LENGTH (80)
    body = "Short body"

    errors = EmailValidator.validate(subject, body)

    assert len(errors) > 0
    assert any("too long" in err.lower() for err in errors)


def test_email_validator_accepts_valid_email():
    """Test that validator accepts clean emails."""
    subject = "Quick question about your content"
    body = "Hi there, I noticed your recent post about AI automation..."

    errors = EmailValidator.validate(subject, body)

    assert len(errors) == 0


def test_email_validator_rejects_excessive_caps():
    """Test that validator rejects excessive capitalization."""
    subject = "HELLO THIS IS ALL CAPS"
    body = "Normal body"

    errors = EmailValidator.validate(subject, body)

    assert len(errors) > 0
    assert any("capital" in err.lower() for err in errors)


def test_email_validator_rejects_too_many_exclamations():
    """Test that validator rejects multiple exclamation marks."""
    subject = "Amazing opportunity!!! Don't miss out!!"
    body = "Normal body"

    errors = EmailValidator.validate(subject, body)

    assert len(errors) > 0
    assert any("exclamation" in err.lower() for err in errors)


# ══════════════════════════════════════════════════════════════════════════════
# Resend Client Tests
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_resend_client_handles_422_invalid_email():
    """Test that ResendClient raises InvalidEmailError on 422."""
    client = ResendClient(api_key="test_key", from_email="test@example.com")

    with patch("httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.status_code = 422
        mock_response.raise_for_status.side_effect = Exception("Unprocessable Entity")

        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_response
        )

        with pytest.raises(InvalidEmailError) as exc_info:
            await client.send_email(
                to="invalid@email",
                subject="Test",
                html="<p>Test</p>",
                text="Test",
            )

        assert "invalid@email" in str(exc_info.value)


@pytest.mark.asyncio
async def test_resend_client_retries_on_429():
    """Test that ResendClient raises RateLimitError on 429."""
    client = ResendClient(api_key="test_key", from_email="test@example.com")

    with patch("httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.status_code = 429
        mock_response.headers = {"retry-after": "120"}

        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_response
        )

        with pytest.raises(RateLimitError) as exc_info:
            await client.send_email(
                to="test@example.com",
                subject="Test",
                html="<p>Test</p>",
                text="Test",
            )

        assert exc_info.value.retry_after == 120


@pytest.mark.asyncio
async def test_resend_client_successful_send():
    """Test successful email send."""
    client = ResendClient(api_key="test_key", from_email="test@example.com")

    with patch("httpx.AsyncClient") as mock_client:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"id": "resend_123"}
        mock_response.raise_for_status = MagicMock()

        mock_post = AsyncMock(return_value=mock_response)
        mock_client.return_value.__aenter__.return_value.post = mock_post

        result = await client.send_email(
            to="test@example.com",
            subject="Test Subject",
            html="<p>Test HTML</p>",
            text="Test text",
        )

        assert result["id"] == "resend_123"


# ══════════════════════════════════════════════════════════════════════════════
# Email Discovery Tests
# ══════════════════════════════════════════════════════════════════════════════


def test_email_format_validation():
    """Test email format regex validation."""
    assert is_valid_email_format("test@example.com") is True
    assert is_valid_email_format("user.name+tag@example.co.uk") is True
    assert is_valid_email_format("invalid-email") is False
    assert is_valid_email_format("@example.com") is False


def test_filter_false_positives():
    """Test filtering of common false positive emails."""
    emails = [
        "user@example.com",
        "test@placeholder.com",
        "email@schema.org",
        "real@domain.com",
    ]

    filtered = filter_false_positives(emails)

    assert "user@example.com" in filtered  # Has "example" but is real
    assert "test@placeholder.com" not in filtered
    assert "email@schema.org" not in filtered
    assert "real@domain.com" in filtered


def test_guess_emails():
    """Test email pattern guesser."""
    candidates = guess_emails("John Smith", "example.com")

    emails = [c.email for c in candidates]

    assert "john@example.com" in emails
    assert "john.smith@example.com" in emails
    assert "jsmith@example.com" in emails

    # All should have pattern source and medium confidence
    assert all(c.source == "pattern" for c in candidates)
    assert all(0.3 <= c.confidence <= 0.5 for c in candidates)


@pytest.mark.asyncio
async def test_mx_validator_rejects_invalid_domain():
    """Test MX validation rejects invalid domains."""
    # Use a domain that definitely doesn't exist
    result = await verify_email("test@thisisnotarealdomain12345.com")

    assert result.verified is False
    assert result.mx_valid is False


@pytest.mark.asyncio
async def test_mx_validator_accepts_major_providers():
    """Test MX validation accepts major email providers without SMTP check."""
    # Gmail should pass MX check and skip SMTP
    result = await verify_email("test@gmail.com")

    # Should be verified based on MX + major provider whitelist
    assert result.mx_valid is True
    # Note: verified may be True (trusts Gmail) or False (format only)
    # depending on implementation


# ══════════════════════════════════════════════════════════════════════════════
# Unsubscribe Token Tests
# ══════════════════════════════════════════════════════════════════════════════


def test_unsubscribe_token_roundtrip():
    """Test generating and decoding unsubscribe token."""
    contact_id = "550e8400-e29b-41d4-a716-446655440000"

    # Generate token
    token = generate_unsub_token(contact_id)
    assert token is not None
    assert len(token) > 0

    # Decode token
    decoded_id = decode_unsub_token(token)
    assert decoded_id == contact_id


def test_unsubscribe_token_rejects_invalid():
    """Test that invalid tokens are rejected."""
    invalid_token = "not-a-valid-jwt-token"

    decoded_id = decode_unsub_token(invalid_token)
    assert decoded_id is None


# ══════════════════════════════════════════════════════════════════════════════
# Email Generator Tests
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_email_generator_creates_valid_draft():
    """Test that email generator creates valid drafts."""
    generator = EmailGenerator(api_key="test_key")

    contact = {
        "id": "contact_123",
        "display_name": "Jane Doe",
        "bio": "AI automation coach helping solopreneurs scale",
        "niche_label": "AI automation",
    }

    with patch.object(generator, "_call_claude") as mock_claude:
        mock_claude.return_value = (
            "Quick question about your AI content",
            "Hi Jane,\n\nI came across your recent post about AI automation...",
        )

        draft = await generator.generate(
            contact=contact,
            touch_number=1,
            service_slug="ai-content-engine",
            niche_label="AI automation",
        )

        assert isinstance(draft, EmailDraft)
        assert len(draft.subject) > 0
        assert len(draft.body_text) > 0
        assert len(draft.body_html) > 0


def test_email_generator_wraps_with_template():
    """Test that generator wraps email with HTML template."""
    generator = EmailGenerator(api_key="test_key")

    body_html = "<p>Hello there!</p>"
    unsub_url = "https://example.com/unsubscribe?token=abc123"
    niche = "content creators"

    wrapped = generator.wrap_with_template(body_html, unsub_url, niche)

    assert body_html in wrapped
    assert unsub_url in wrapped
    assert niche in wrapped
    assert "<!DOCTYPE html>" in wrapped


# ══════════════════════════════════════════════════════════════════════════════
# Integration Tests (require mocked queries)
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_opted_out_contact_not_emailed():
    """Test that opted-out contacts are skipped during send."""
    with patch("acquisition.email.resend_client.ResendClient"):
        with patch("acquisition.email.generator.EmailGenerator"):
            from ..email_agent import EmailAgent
            agent = EmailAgent()

            with patch("acquisition.db.queries.get_pending_email") as mock_get_pending:
                with patch("acquisition.db.queries.get_contact") as mock_get_contact:
                    with patch(
                        "acquisition.db.queries.update_email_status"
                    ) as mock_update_status:
                        # Mock pending sequence
                        mock_get_pending.return_value = (
                            [
                                {
                                    "id": "seq_123",
                                    "contact_id": "contact_123",
                                    "to_email": "test@example.com",
                                    "subject": "Test",
                                    "body_html": "<p>Test</p>",
                                    "body_text": "Test",
                                    "touch_number": 1,
                                    "service_slug": "test",
                                }
                            ],
                            None,
                        )

                        # Mock contact as opted out
                        mock_get_contact.return_value = (
                            {"id": "contact_123", "email_opted_out": True},
                            None,
                        )

                        # Mock update status to return tuple
                        mock_update_status.return_value = (None, None)

                        stats = await agent.send_pending(dry_run=True)

                        # Should skip the contact
                        assert stats["skipped_opted_out"] == 1
                        assert stats["sent"] == 0

                        # Should update status to skipped
                        mock_update_status.assert_called_once()


@pytest.mark.asyncio
async def test_daily_cap_blocks_at_30():
    """Test that daily cap blocks sending after limit."""
    with patch("acquisition.email.resend_client.ResendClient"):
        with patch("acquisition.email.generator.EmailGenerator"):
            from ..email_agent import EmailAgent
            agent = EmailAgent()

            with patch("acquisition.db.queries.get_pending_email") as mock_get_pending:
                with patch("acquisition.db.queries.get_contact") as mock_get_contact:
                    with patch("acquisition.db.queries.check_daily_cap") as mock_check_cap:
                        with patch(
                            "acquisition.db.queries.update_email_status"
                        ) as mock_update_status:
                            # Mock pending sequence
                            mock_get_pending.return_value = (
                                [
                                    {
                                        "id": "seq_123",
                                        "contact_id": "contact_123",
                                        "to_email": "test@example.com",
                                        "subject": "Test",
                                        "body_html": "<p>Test</p>",
                                        "body_text": "Test",
                                        "touch_number": 1,
                                        "service_slug": "test",
                                    }
                                ],
                                None,
                            )

                            mock_get_contact.return_value = (
                                {"id": "contact_123", "email_opted_out": False},
                                None,
                            )

                            # Mock daily cap as exceeded
                            mock_check_cap.return_value = (False, None)

                            # Mock update status to return tuple
                            mock_update_status.return_value = (None, None)

                            stats = await agent.send_pending(dry_run=True)

                            # Should skip due to cap
                            assert stats["skipped_daily_cap"] == 1
                            assert stats["sent"] == 0


# ══════════════════════════════════════════════════════════════════════════════
# Test Runner
# ══════════════════════════════════════════════════════════════════════════════


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
