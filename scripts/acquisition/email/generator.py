"""
acquisition/email/generator.py — Claude-powered email generation.

Generates 3-touch email sequences with:
- Touch 1: Value-first introduction (Sonnet 3.5)
- Touch 2: Case study/proof (Haiku 3)
- Touch 3: Direct CTA (Haiku 3)

All emails are CAN-SPAM compliant with unsubscribe links.
"""
import os
import re
import httpx
from dataclasses import dataclass
from typing import Optional

from ..config import (
    ANTHROPIC_API_KEY,
    FROM_EMAIL,
    OWNER_EMAIL,
)


# SPAM word blacklist
SPAM_WORDS = [
    "free money",
    "act now",
    "limited time",
    "earn extra",
    "guaranteed",
    "no risk",
    "increase sales",
    "make money fast",
    "click here",
    "buy now",
    "order now",
    "special promotion",
    "exclusive deal",
    "winner",
    "congratulations",
    "100% free",
    "risk free",
    "cash bonus",
    "double your",
    "earn from home",
]

# CAN-SPAM compliance
PHYSICAL_ADDRESS = os.environ.get(
    "COMPANY_ADDRESS", "1234 Main St, San Francisco, CA 94102"
)


@dataclass
class EmailDraft:
    """Generated email draft with validation."""

    subject: str
    body_text: str
    body_html: str
    validation_errors: list[str]

    @property
    def is_valid(self) -> bool:
        """Check if email passes validation."""
        return len(self.validation_errors) == 0


class EmailValidator:
    """Validates emails for SPAM compliance and quality."""

    MAX_SUBJECT_LENGTH = 80
    MAX_BODY_LENGTH = 2000

    @staticmethod
    def validate(subject: str, body_text: str) -> list[str]:
        """
        Validate email content.

        Returns:
            List of validation errors (empty if valid)
        """
        errors = []

        # Check subject length
        if len(subject) > EmailValidator.MAX_SUBJECT_LENGTH:
            errors.append(
                f"Subject too long ({len(subject)} chars, max {EmailValidator.MAX_SUBJECT_LENGTH})"
            )

        # Check body length
        if len(body_text) > EmailValidator.MAX_BODY_LENGTH:
            errors.append(
                f"Body too long ({len(body_text)} chars, max {EmailValidator.MAX_BODY_LENGTH})"
            )

        # Check for spam words
        combined = (subject + " " + body_text).lower()
        found_spam = [word for word in SPAM_WORDS if word in combined]
        if found_spam:
            errors.append(f"Contains spam words: {', '.join(found_spam)}")

        # Check for excessive caps
        caps_ratio = sum(1 for c in subject if c.isupper()) / max(len(subject), 1)
        if caps_ratio > 0.5:
            errors.append("Subject has too many capital letters")

        # Check for excessive exclamation marks
        if subject.count("!") > 1:
            errors.append("Subject has too many exclamation marks")

        return errors


class EmailGenerator:
    """
    Generate personalized emails using Claude API.

    Uses:
    - claude-3-5-sonnet-20241022 for Touch 1 (higher quality)
    - claude-3-haiku-20240307 for Touch 2 & 3 (cost-effective)
    """

    def __init__(self, api_key: Optional[str] = None):
        """Initialize generator with Claude API key."""
        self.api_key = api_key or ANTHROPIC_API_KEY
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY is required")

    async def generate(
        self,
        contact: dict,
        touch_number: int,
        service_slug: str,
        niche_label: Optional[str] = None,
    ) -> EmailDraft:
        """
        Generate email for a contact.

        Args:
            contact: Contact dict with display_name, bio, etc.
            touch_number: 1, 2, or 3
            service_slug: Service identifier (e.g., "ai-content-engine")
            niche_label: Optional niche context

        Returns:
            EmailDraft with subject and body
        """
        # Select model based on touch
        model = (
            "claude-3-5-sonnet-20241022"
            if touch_number == 1
            else "claude-3-haiku-20240307"
        )

        # Generate prompt based on touch number
        prompt = self._build_prompt(contact, touch_number, service_slug, niche_label)

        # Call Claude API
        subject, body_text = await self._call_claude(prompt, model)

        # Convert to HTML
        body_html = self._text_to_html(body_text)

        # Validate
        validation_errors = EmailValidator.validate(subject, body_text)

        return EmailDraft(
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            validation_errors=validation_errors,
        )

    def _build_prompt(
        self,
        contact: dict,
        touch_number: int,
        service_slug: str,
        niche_label: Optional[str] = None,
    ) -> str:
        """Build Claude prompt based on touch number."""
        display_name = contact.get("display_name", "there")
        bio = contact.get("bio", "")
        niche = niche_label or "content creation"

        if touch_number == 1:
            return f"""Write a personalized outreach email for {display_name}, a {niche} creator.

Bio: {bio}

Requirements:
- Subject line: Under 60 chars, personalized, no spam words
- Body: 3-4 short paragraphs (max 200 words total)
- Tone: Helpful, not salesy
- Lead with value/insight specific to their content
- Briefly mention how our {service_slug} service helps creators like them
- End with soft CTA (e.g., "Would you be open to a quick chat?")
- No spam words like "free money", "guaranteed", "act now"
- Natural, conversational language

Format your response as:
SUBJECT: [subject line]
BODY:
[email body]
"""

        elif touch_number == 2:
            return f"""Write a follow-up email (Touch 2) for {display_name}, a {niche} creator.

They didn't respond to our first email about {service_slug}.

Requirements:
- Subject line: Reference previous email or add new value
- Body: 2-3 paragraphs (max 150 words)
- Share a quick case study or specific result
- No pressure, just additional context
- Soft CTA

Format your response as:
SUBJECT: [subject line]
BODY:
[email body]
"""

        else:  # touch_number == 3
            return f"""Write a final follow-up email (Touch 3) for {display_name}.

This is our last touchpoint before moving on.

Requirements:
- Subject line: Simple, direct
- Body: 1-2 paragraphs (max 100 words)
- Acknowledge they're busy
- Direct CTA or graceful exit
- Professional and respectful

Format your response as:
SUBJECT: [subject line]
BODY:
[email body]
"""

    async def _call_claude(self, prompt: str, model: str) -> tuple[str, str]:
        """
        Call Claude API and extract subject + body.

        Returns:
            Tuple of (subject, body_text)
        """
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 1024,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )

            response.raise_for_status()
            data = response.json()

            # Extract text from Claude response
            text = data["content"][0]["text"]

            # Parse subject and body
            subject, body = self._parse_response(text)

            return subject, body

    def _parse_response(self, text: str) -> tuple[str, str]:
        """
        Parse Claude response to extract subject and body.

        Expected format:
        SUBJECT: [subject line]
        BODY:
        [email body]
        """
        lines = text.strip().split("\n")

        subject = ""
        body_lines = []
        in_body = False

        for line in lines:
            if line.startswith("SUBJECT:"):
                subject = line.replace("SUBJECT:", "").strip()
            elif line.startswith("BODY:"):
                in_body = True
            elif in_body:
                body_lines.append(line)

        body = "\n".join(body_lines).strip()

        # Fallback if parsing failed
        if not subject:
            subject = "Quick question"
        if not body:
            body = text

        return subject, body

    def _text_to_html(self, text: str) -> str:
        """
        Convert plain text to HTML paragraphs.

        Args:
            text: Plain text email body

        Returns:
            HTML formatted text
        """
        # Split by double newlines to get paragraphs
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

        # Wrap each paragraph in <p> tags
        html_paragraphs = [f"<p>{p.replace(chr(10), '<br>')}</p>" for p in paragraphs]

        return "\n".join(html_paragraphs)

    def wrap_with_template(
        self,
        body_html: str,
        unsubscribe_url: str,
        niche: str,
    ) -> str:
        """
        Wrap email body with HTML template.

        Args:
            body_html: HTML email body
            unsubscribe_url: Unsubscribe link
            niche: Niche label for footer

        Returns:
            Complete HTML email
        """
        # Read template
        template_path = os.path.join(
            os.path.dirname(__file__), "templates", "base.html"
        )

        with open(template_path, "r") as f:
            template = f.read()

        # Replace placeholders
        html = template.format(
            body_html=body_html,
            niche=niche,
            unsubscribe_url=unsubscribe_url,
            physical_address=PHYSICAL_ADDRESS,
        )

        return html
