"""
acquisition/email — Email outreach components for AAG Agent 08.

Modules:
- resend_client: Resend API client for sending emails
- discovery: Multi-source email discovery and verification
- generator: Claude-powered email generation
- imap_watcher: IMAP inbox monitoring for replies
"""
from .resend_client import ResendClient, InvalidEmailError, RateLimitError
from .discovery import (
    extract_linkedin_email,
    scrape_website_email,
    guess_emails,
    search_email_perplexity,
    verify_email,
    EmailCandidate,
    VerifyResult,
)
from .generator import EmailGenerator, EmailValidator, EmailDraft

__all__ = [
    "ResendClient",
    "InvalidEmailError",
    "RateLimitError",
    "EmailGenerator",
    "EmailValidator",
    "EmailDraft",
    "EmailCandidate",
    "VerifyResult",
    "extract_linkedin_email",
    "scrape_website_email",
    "guess_emails",
    "search_email_perplexity",
    "verify_email",
]
