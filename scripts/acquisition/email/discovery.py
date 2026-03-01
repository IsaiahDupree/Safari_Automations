"""
acquisition/email/discovery.py — Email discovery from multiple sources.

Discovery priority order:
1. LinkedIn email extract (if public)
2. Website scraper (contact/about pages)
3. Pattern guesser (firstname@domain, etc.)
4. Perplexity search
5. Email verification (MX + SMTP checks)
"""
import re
import smtplib
import dns.resolver
import httpx
from typing import Optional, NamedTuple
from dataclasses import dataclass

from ..config import PERPLEXITY_API_KEY


@dataclass
class EmailCandidate:
    """Represents a discovered email with metadata."""

    email: str
    source: str  # linkedin, website, pattern, perplexity
    confidence: float  # 0.0 to 1.0
    verified: bool = False
    mx_valid: bool = False


class VerifyResult(NamedTuple):
    """Result from email verification."""

    verified: bool
    mx_valid: bool


# ══════════════════════════════════════════════════════════════════════════════
# Email Regex
# ══════════════════════════════════════════════════════════════════════════════

EMAIL_REGEX = r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"

# Common false positives to filter out
# Patterns that indicate placeholder/test emails
LOCAL_PART_PATTERNS = [
    "placeholder",
    "test",
    "sample",
    "your-email",
    "youremail",
    "noreply",
]

# Patterns that indicate fake domains
DOMAIN_PATTERNS = [
    "schema.org",
    "placeholder.com",
]


def is_valid_email_format(email: str) -> bool:
    """Quick regex check for email format."""
    return bool(re.match(EMAIL_REGEX, email))


def filter_false_positives(emails: list[str]) -> list[str]:
    """Remove common false positive emails."""
    filtered = []
    for e in emails:
        email_lower = e.lower()

        # Split into local and domain
        if '@' not in email_lower:
            continue

        local_part, domain = email_lower.split('@', 1)

        # Check local part for test/placeholder patterns
        local_is_fake = any(pattern in local_part for pattern in LOCAL_PART_PATTERNS)

        # Check domain for known fake domains
        domain_is_fake = any(pattern in domain for pattern in DOMAIN_PATTERNS)

        if not (local_is_fake or domain_is_fake):
            filtered.append(e)

    return filtered


# ══════════════════════════════════════════════════════════════════════════════
# Source 1: LinkedIn Email Extract
# ══════════════════════════════════════════════════════════════════════════════


async def extract_linkedin_email(linkedin_url: str) -> Optional[str]:
    """
    Extract email from LinkedIn profile if publicly listed.

    This requires the LinkedIn automation service running on port 3105.
    Most profiles don't have public emails, so this often returns None.

    Args:
        linkedin_url: Full LinkedIn profile URL

    Returns:
        Email address if found, None otherwise
    """
    if not linkedin_url:
        return None

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "http://localhost:3105/api/linkedin/profile/extract",
                json={"profileUrl": linkedin_url},
            )

            if response.status_code == 200:
                data = response.json()
                return data.get("email")

    except Exception:
        # LinkedIn service may not be running or profile not accessible
        pass

    return None


# ══════════════════════════════════════════════════════════════════════════════
# Source 2: Website Email Scraper
# ══════════════════════════════════════════════════════════════════════════════


async def scrape_website_email(website_url: str) -> Optional[str]:
    """
    Scrape email from website by checking common pages.

    Checks:
    1. Homepage
    2. /contact
    3. /about
    4. /team

    Args:
        website_url: Base website URL (e.g., https://example.com)

    Returns:
        First valid email found, None if no emails found
    """
    if not website_url:
        return None

    # Ensure URL has protocol
    if not website_url.startswith(("http://", "https://")):
        website_url = f"https://{website_url}"

    urls_to_check = [
        website_url,
        f"{website_url}/contact",
        f"{website_url}/about",
        f"{website_url}/team",
    ]

    for url in urls_to_check:
        try:
            async with httpx.AsyncClient(
                timeout=10.0,
                headers={"User-Agent": "Mozilla/5.0 (compatible; EmailDiscovery/1.0)"},
                follow_redirects=True,
            ) as client:
                response = await client.get(url)

                if response.status_code == 200:
                    # Find all emails in page
                    emails = re.findall(EMAIL_REGEX, response.text)
                    valid = filter_false_positives(emails)

                    if valid:
                        return valid[0]  # Return first valid email

        except Exception:
            # Page doesn't exist or network error
            continue

    return None


# ══════════════════════════════════════════════════════════════════════════════
# Source 3: Pattern Guesser
# ══════════════════════════════════════════════════════════════════════════════

# Common email patterns (in priority order)
PATTERNS = [
    lambda f, l, d: f"{f}@{d}",  # john@example.com
    lambda f, l, d: f"{f}.{l}@{d}",  # john.smith@example.com
    lambda f, l, d: f"{f[0]}{l}@{d}",  # jsmith@example.com
    lambda f, l, d: f"{f}{l[0]}@{d}",  # johns@example.com
    lambda f, l, d: f"{l}.{f}@{d}",  # smith.john@example.com
]


def guess_emails(display_name: str, domain: str) -> list[EmailCandidate]:
    """
    Generate likely email patterns from name and domain.

    Args:
        display_name: Full name (e.g., "John Smith")
        domain: Email domain (e.g., "example.com")

    Returns:
        List of EmailCandidate objects with guessed emails
    """
    if not display_name or not domain:
        return []

    # Parse name parts
    parts = display_name.lower().strip().split()
    if not parts:
        return []

    first = parts[0]
    last = parts[-1] if len(parts) > 1 else parts[0]

    # Generate patterns
    candidates = []
    for pattern in PATTERNS:
        try:
            email = pattern(first, last, domain)
            candidates.append(
                EmailCandidate(
                    email=email, source="pattern", confidence=0.4, verified=False
                )
            )
        except Exception:
            continue

    return candidates


# ══════════════════════════════════════════════════════════════════════════════
# Source 4: Perplexity Email Search
# ══════════════════════════════════════════════════════════════════════════════


async def search_email_perplexity(
    display_name: str, niche_label: Optional[str] = None
) -> Optional[str]:
    """
    Search for email using Perplexity AI.

    Args:
        display_name: Person's name
        niche_label: Optional niche/profession context

    Returns:
        Email if found, None otherwise
    """
    if not PERPLEXITY_API_KEY:
        return None

    # Build search query
    context = f"the {niche_label} creator" if niche_label else "creator"
    query = f"What is the email address for {display_name} {context}?"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.perplexity.ai/chat/completions",
                headers={
                    "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.1-sonar-small-128k-online",
                    "messages": [{"role": "user", "content": query}],
                },
            )

            if response.status_code == 200:
                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

                # Extract email from response
                emails = re.findall(EMAIL_REGEX, content)
                valid = filter_false_positives(emails)

                if valid:
                    return valid[0]

    except Exception:
        pass

    return None


# ══════════════════════════════════════════════════════════════════════════════
# Email Verifier (MX + SMTP)
# ══════════════════════════════════════════════════════════════════════════════

# Major providers that block SMTP verification
SKIP_SMTP_PROVIDERS = {
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "yahoo.com",
    "icloud.com",
    "me.com",
    "mac.com",
}


async def verify_email(email: str) -> VerifyResult:
    """
    Verify email address using MX and SMTP checks.

    Process:
    1. Extract domain from email
    2. Check MX records (DNS)
    3. For non-major providers, attempt SMTP RCPT TO check
    4. For major providers (Gmail, Outlook, etc.), skip SMTP as they block it

    Args:
        email: Email address to verify

    Returns:
        VerifyResult with verification status
    """
    if not is_valid_email_format(email):
        return VerifyResult(verified=False, mx_valid=False)

    try:
        domain = email.split("@")[1]
    except IndexError:
        return VerifyResult(verified=False, mx_valid=False)

    # Step 1: MX record check
    try:
        mx_records = dns.resolver.resolve(domain, "MX")
        mx_valid = len(mx_records) > 0
    except Exception:
        return VerifyResult(verified=False, mx_valid=False)

    if not mx_valid:
        return VerifyResult(verified=False, mx_valid=False)

    # Step 2: For major providers, trust MX check only
    if domain.lower() in SKIP_SMTP_PROVIDERS:
        return VerifyResult(verified=True, mx_valid=True)

    # Step 3: SMTP RCPT TO check for other providers
    try:
        # Get MX host with highest priority (lowest preference number)
        mx_host = str(sorted(mx_records, key=lambda r: r.preference)[0].exchange)

        # Connect to SMTP server and check if address exists
        with smtplib.SMTP(mx_host, 25, timeout=10) as smtp:
            smtp.helo("verify.example.com")
            smtp.mail("verify@example.com")
            code, _ = smtp.rcpt(email)

            # 250 = address exists, 550/551 = doesn't exist
            verified = code == 250

        return VerifyResult(verified=verified, mx_valid=True)

    except Exception:
        # SMTP verification failed, but MX is valid so email might still work
        # Return verified=False but mx_valid=True
        return VerifyResult(verified=False, mx_valid=True)
