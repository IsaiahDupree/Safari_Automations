"""
acquisition/outreach_agent.py — Agent 05: Outreach Agent

Generates personalized first DMs using Claude (informed by contact's actual posts),
sends them via the correct platform DM service, and writes every touch to crm_messages.
Also coordinates with email channel to ensure only one active outreach channel per contact.
"""
import asyncio
import json
import os
import sys
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from acquisition.config import (
    ANTHROPIC_API_KEY,
    DM_SERVICE_PORTS,
    MARKET_RESEARCH_PORT,
    CLAUDE_MODEL_GENERATION,
    DEFAULT_DAILY_CAPS,
)
from acquisition.db import queries


# ══════════════════════════════════════════════════════════════════════════════
# Data Types
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class PostData:
    """Represents a post from market research."""
    text: str
    likes: int
    comments: int
    url: str = ""


@dataclass
class ContactBrief:
    """Rich context about a contact for DM generation."""
    contact_id: str
    display_name: str
    platform: str
    handle: str
    score: int
    score_reasoning: str
    top_posts: list[PostData]
    niche: str
    follower_count: int
    service_description: str


@dataclass
class ValidationResult:
    """Result of message validation."""
    score: int
    errors: list[str]
    passed: bool


@dataclass
class SendResult:
    """Result of sending a DM."""
    success: bool
    dry_run: bool = False
    platform_message_id: Optional[str] = None
    error: Optional[str] = None


@dataclass
class TouchResult:
    """Result of processing a single contact."""
    contact_id: str
    success: bool
    message: str = ""
    error: Optional[str] = None
    validation_score: int = 0


@dataclass
class OutreachResult:
    """Summary of an outreach run."""
    total_processed: int
    successful: int
    failed: int
    skipped: int
    touches: list[TouchResult] = field(default_factory=list)


# ══════════════════════════════════════════════════════════════════════════════
# Service Descriptions
# ══════════════════════════════════════════════════════════════════════════════

SERVICE_DESCRIPTIONS = {
    "ai-content-engine": (
        "AI-powered content engine that helps creators generate high-quality "
        "social media posts using automation and AI. Ideal for solopreneurs "
        "looking to scale their content output without sacrificing quality."
    ),
    "linkedin-lead-gen": (
        "LinkedIn lead generation system that identifies and engages with "
        "high-quality prospects through automated outreach and follow-up. "
        "Perfect for B2B agencies looking to build a predictable sales pipeline."
    ),
    "social-outreach": (
        "Multi-platform social media outreach automation that helps creators "
        "and agencies build relationships at scale through personalized engagement "
        "and strategic follow-up."
    ),
}


# ══════════════════════════════════════════════════════════════════════════════
# Message Validator
# ══════════════════════════════════════════════════════════════════════════════

BANNED_PHRASES = [
    "hope this finds you",
    "reaching out",
    "quick call",
    "pick your brain",
    "synergy",
    "i noticed your profile",
    "would love to connect",
    "let me know if you're interested",
    "free consultation",
]

MAX_LENGTH = {
    "twitter": 280,
    "instagram": 1000,
    "tiktok": 500,
    "linkedin": 500,
}


class MessageValidator:
    """Validates DM messages against quality criteria."""

    @staticmethod
    def validate(message: str, platform: str) -> ValidationResult:
        """
        Validate a message for quality and compliance.

        Score starts at 10 and is reduced for violations:
        - Too long: -4
        - Banned phrase: -3 each
        - No specific reference: -2
        - Must score >= 7 to pass
        """
        score = 10
        errors = []

        # Check length
        max_len = MAX_LENGTH.get(platform, 500)
        if len(message) > max_len:
            score -= 4
            errors.append(f"too_long:{len(message)}>{max_len}")

        # Check for banned phrases
        message_lower = message.lower()
        for phrase in BANNED_PHRASES:
            if phrase.lower() in message_lower:
                score -= 3
                errors.append(f"banned:{phrase}")

        # Check for specific reference (basic heuristic: quotes or capitalized words)
        has_quote = '"' in message or "'" in message
        has_proper_noun = any(word[0].isupper() for word in message.split() if len(word) > 2)
        if not has_quote and not has_proper_noun:
            score -= 2
            errors.append("no_specific_reference")

        return ValidationResult(
            score=score,
            errors=errors,
            passed=score >= 7,
        )


# ══════════════════════════════════════════════════════════════════════════════
# Context Builder
# ══════════════════════════════════════════════════════════════════════════════

class ContextBuilder:
    """Builds rich context about a contact for personalized outreach."""

    @staticmethod
    async def build_context(contact: dict, service_slug: str) -> ContactBrief:
        """
        Build a comprehensive context brief for a contact.

        Fetches:
        - Top posts from market research
        - Latest ICP score and reasoning
        - Service description for the offer
        """
        # Get top posts from market research
        top_posts = await ContextBuilder._get_top_posts(contact["id"], limit=3)

        # Get latest score
        score = contact.get("icp_score", 0)
        score_reasoning = contact.get("score_reasoning", "No reasoning available")

        # Get service description
        service_description = SERVICE_DESCRIPTIONS.get(
            service_slug,
            "AI-powered automation services for content creators and agencies."
        )

        return ContactBrief(
            contact_id=contact["id"],
            display_name=contact.get("display_name", contact.get("handle", "Unknown")),
            platform=contact["primary_platform"],
            handle=contact.get("handle", ""),
            score=score,
            score_reasoning=score_reasoning,
            top_posts=top_posts,
            niche=contact.get("niche", "content creator"),
            follower_count=contact.get("follower_count", 0),
            service_description=service_description,
        )

    @staticmethod
    async def _get_top_posts(contact_id: str, limit: int = 3) -> list[PostData]:
        """Fetch top posts for a contact from market research."""
        try:
            # Query market research service
            url = f"http://localhost:{MARKET_RESEARCH_PORT}/api/posts/{contact_id}?limit={limit}"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read())
                posts = data.get("posts", [])
                return [
                    PostData(
                        text=p.get("text", ""),
                        likes=p.get("likes", 0),
                        comments=p.get("comments", 0),
                        url=p.get("url", ""),
                    )
                    for p in posts
                ]
        except Exception as e:
            print(f"⚠️  Failed to fetch posts for {contact_id}: {e}")
            return []


# ══════════════════════════════════════════════════════════════════════════════
# DM Generator
# ══════════════════════════════════════════════════════════════════════════════

class DMGenerator:
    """Generates personalized DMs using Claude."""

    @staticmethod
    async def generate_dm(brief: ContactBrief, service_slug: str, touch: int = 1) -> str:
        """
        Generate a personalized first DM using Claude Sonnet.

        Uses contact's actual posts and ICP score to create a genuine,
        peer-to-peer message that doesn't feel like a pitch.
        """
        # Build the prompt
        top_post = brief.top_posts[0] if brief.top_posts else None
        top_post_text = top_post.text if top_post else "No posts available"
        top_post_likes = top_post.likes if top_post else 0

        prompt = f"""You are writing a personalized first DM to a prospect on {brief.platform}.

Contact context:
- Name: {brief.display_name}
- Platform: {brief.platform} (@{brief.handle})
- ICP Score: {brief.score}/100
- Score reasoning: {brief.score_reasoning}
- Their top post: "{top_post_text}" ({top_post_likes} likes)
- Their niche: {brief.niche}

Service being offered: {brief.service_description}

Write a first DM that:
1. Opens with ONE specific reference to their content (not "great content!" — be specific)
2. Delivers a genuine insight or relevant observation in 1-2 sentences
3. Makes a soft, low-pressure ask — NOT a pitch, NOT a meeting request
   (e.g., "Curious if you've tried [X] — would love to share what we're seeing work for accounts like yours")
4. Feels like a peer reaching out, not a vendor
5. Max 4 sentences total. No emojis. No "I hope this finds you well." No "reaching out."

DM (write only the message, nothing else):"""

        # Call Claude API
        try:
            url = "https://api.anthropic.com/v1/messages"
            data = {
                "model": CLAUDE_MODEL_GENERATION,
                "max_tokens": 300,
                "messages": [{"role": "user", "content": prompt}],
            }
            headers = {
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(data).encode(),
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                result = json.loads(response.read())
                message = result["content"][0]["text"].strip()
                return message
        except Exception as e:
            print(f"❌ Claude API error: {e}")
            raise


# ══════════════════════════════════════════════════════════════════════════════
# DM Sender
# ══════════════════════════════════════════════════════════════════════════════

class DMSender:
    """Sends DMs via platform-specific services."""

    DM_SEND_ENDPOINTS = {
        "instagram": f"http://localhost:{DM_SERVICE_PORTS['instagram']}/api/messages/send-to",
        "twitter": f"http://localhost:{DM_SERVICE_PORTS['twitter']}/api/messages/send-to",
        "tiktok": f"http://localhost:{DM_SERVICE_PORTS['tiktok']}/api/messages/send-to",
        "linkedin": f"http://localhost:{DM_SERVICE_PORTS['linkedin']}/api/linkedin/messages",
    }

    @staticmethod
    async def send_dm(contact: dict, message: str, dry_run: bool = False) -> SendResult:
        """
        Send a DM via the appropriate platform service.

        LinkedIn requires a 2-step process:
        1. Open conversation
        2. Send message

        Other platforms use a single endpoint.
        """
        if dry_run:
            print(f"[DRY RUN] Would send to {contact['display_name']}: {message[:50]}...")
            return SendResult(success=True, dry_run=True)

        platform = contact["primary_platform"]
        handle = contact.get("handle", contact.get("display_name", ""))

        # Check daily cap
        can_send, err = queries.increment_daily_cap("dm", platform)
        if not can_send:
            if err:
                return SendResult(success=False, error=f"Daily cap check failed: {err}")
            else:
                return SendResult(success=False, error="Daily cap reached")

        try:
            if platform == "linkedin":
                # Two-step LinkedIn flow
                return await DMSender._send_linkedin(contact, message)
            else:
                # Standard single-step flow
                return await DMSender._send_standard(platform, handle, message)
        except Exception as e:
            print(f"❌ Send error: {e}")
            return SendResult(success=False, error=str(e))

    @staticmethod
    async def _send_linkedin(contact: dict, message: str) -> SendResult:
        """Send LinkedIn DM via 2-step process."""
        base_url = DMSender.DM_SEND_ENDPOINTS["linkedin"]
        display_name = contact.get("display_name", "")

        # Step 1: Open conversation
        open_url = f"{base_url}/open"
        open_data = {"participantName": display_name}
        req = urllib.request.Request(
            open_url,
            data=json.dumps(open_data).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            open_result = json.loads(response.read())
            if not open_result.get("success"):
                return SendResult(success=False, error="LinkedIn open conversation failed")

        # Step 2: Send message
        send_url = f"{base_url}/send"
        send_data = {"text": message}
        req = urllib.request.Request(
            send_url,
            data=json.dumps(send_data).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            send_result = json.loads(response.read())
            return SendResult(
                success=send_result.get("success", False),
                platform_message_id=send_result.get("messageId"),
            )

    @staticmethod
    async def _send_standard(platform: str, handle: str, message: str) -> SendResult:
        """Send DM via standard endpoint (Instagram, Twitter, TikTok)."""
        url = DMSender.DM_SEND_ENDPOINTS.get(platform)
        if not url:
            return SendResult(success=False, error=f"Unsupported platform: {platform}")

        data = {"username": handle, "message": message}
        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read())
            return SendResult(
                success=result.get("success", False),
                platform_message_id=result.get("messageId"),
            )


# ══════════════════════════════════════════════════════════════════════════════
# Touch Recorder
# ══════════════════════════════════════════════════════════════════════════════

class TouchRecorder:
    """Records outreach touches in the database."""

    @staticmethod
    async def record_touch(
        contact: dict,
        message: str,
        result: SendResult,
        service_slug: str,
        touch_number: int = 1,
    ) -> None:
        """
        Record a touch in all relevant tables:
        1. crm_messages - the actual message
        2. acq_outreach_sequences - the outreach sequence entry
        3. crm_contacts - update pipeline stage and last_outbound_at
        4. acq_funnel_events - record stage transition
        """
        utcnow = datetime.now(timezone.utc).isoformat()
        contact_id = contact["id"]
        platform = contact["primary_platform"]

        # 1. Insert into crm_messages
        queries.insert_crm_message(
            contact_id=contact_id,
            message_type="dm",
            is_outbound=True,
            message_text=message,
            sent_at=utcnow,
        )

        # 2. Insert into acq_outreach_sequences
        sequence = {
            "contact_id": contact_id,
            "service_slug": service_slug,
            "touch_number": touch_number,
            "message_text": message,
            "platform": platform,
            "sent_at": utcnow,
            "status": "sent" if result.success else "failed",
            "platform_message_id": result.platform_message_id,
        }
        queries.insert_outreach_sequence(sequence)

        # 3. Update pipeline stage to 'contacted'
        queries.update_pipeline_stage(contact_id, "contacted", "outreach_agent")

        # 4. Update last_outbound_at timestamp
        queries.update_last_outbound_at(contact_id, utcnow)

        # 5. Funnel event is recorded by update_pipeline_stage

        print(f"✅ Recorded touch for {contact.get('display_name', contact_id)}")


# ══════════════════════════════════════════════════════════════════════════════
# Outreach Agent
# ══════════════════════════════════════════════════════════════════════════════

class OutreachAgent:
    """
    Agent 05: Outreach Agent

    Generates personalized first DMs using Claude, sends them via platform
    services, and records all touches in the database.
    """

    def __init__(self):
        self.context_builder = ContextBuilder()
        self.generator = DMGenerator()
        self.validator = MessageValidator()
        self.sender = DMSender()
        self.recorder = TouchRecorder()

    async def run(
        self,
        service_slug: str = "ai-content-engine",
        limit: int = 10,
        dry_run: bool = False,
    ) -> OutreachResult:
        """
        Run the outreach agent.

        Args:
            service_slug: Which service offering to pitch
            limit: Max contacts to process
            dry_run: If True, generate messages but don't send

        Returns:
            OutreachResult with summary statistics
        """
        print(f"🚀 Starting outreach run (service={service_slug}, limit={limit}, dry_run={dry_run})")

        # Get contacts ready for DM
        contacts, err = queries.get_ready_for_dm(limit=limit)
        if err:
            print(f"❌ Failed to fetch contacts: {err}")
            return OutreachResult(total_processed=0, successful=0, failed=0, skipped=0)

        if not contacts:
            print("ℹ️  No contacts ready for DM")
            return OutreachResult(total_processed=0, successful=0, failed=0, skipped=0)

        print(f"📋 Found {len(contacts)} contacts ready for DM")

        # Process each contact
        result = OutreachResult(total_processed=0, successful=0, failed=0, skipped=0)
        for contact in contacts:
            touch_result = await self.process_contact(contact, service_slug, dry_run)
            result.touches.append(touch_result)
            result.total_processed += 1

            if touch_result.success:
                result.successful += 1
            elif touch_result.error and "skipped" in touch_result.error.lower():
                result.skipped += 1
            else:
                result.failed += 1

            # Small delay between sends to avoid rate limits
            await asyncio.sleep(2)

        print(f"\n✅ Outreach complete: {result.successful} sent, {result.failed} failed, {result.skipped} skipped")
        return result

    async def process_contact(
        self,
        contact: dict,
        service_slug: str,
        dry_run: bool = False,
    ) -> TouchResult:
        """Process a single contact for outreach."""
        contact_id = contact["id"]
        display_name = contact.get("display_name", contact.get("handle", "Unknown"))

        try:
            print(f"\n🎯 Processing {display_name} ({contact['primary_platform']})...")

            # Build context
            brief = await self.context_builder.build_context(contact, service_slug)

            # Generate DM
            message = await self.generator.generate_dm(brief, service_slug, touch=1)
            print(f"💬 Generated: {message[:80]}...")

            # Validate
            validation = self.validator.validate(message, brief.platform)
            print(f"✔️  Validation: score={validation.score}, passed={validation.passed}")

            if not validation.passed:
                print(f"⚠️  Validation failed: {validation.errors}")
                return TouchResult(
                    contact_id=contact_id,
                    success=False,
                    message=message,
                    error=f"Validation failed: {validation.errors}",
                    validation_score=validation.score,
                )

            # Send
            send_result = await self.sender.send_dm(contact, message, dry_run=dry_run)

            if not send_result.success and not dry_run:
                return TouchResult(
                    contact_id=contact_id,
                    success=False,
                    message=message,
                    error=send_result.error or "Send failed",
                    validation_score=validation.score,
                )

            # Record touch
            if not dry_run:
                await self.recorder.record_touch(contact, message, send_result, service_slug)

            return TouchResult(
                contact_id=contact_id,
                success=True,
                message=message,
                validation_score=validation.score,
            )

        except Exception as e:
            print(f"❌ Error processing {display_name}: {e}")
            return TouchResult(
                contact_id=contact_id,
                success=False,
                error=str(e),
            )


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

async def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Agent 05: Outreach Agent")
    parser.add_argument(
        "--service",
        default="ai-content-engine",
        choices=list(SERVICE_DESCRIPTIONS.keys()),
        help="Service offering to pitch",
    )
    parser.add_argument("--limit", type=int, default=10, help="Max contacts to process")
    parser.add_argument("--generate", action="store_true", help="Preview mode: generate but don't send")
    parser.add_argument("--send", action="store_true", help="Send mode: actually send DMs")
    parser.add_argument("--dry-run", action="store_true", help="Dry run: validate but don't send")

    args = parser.parse_args()

    # Determine mode
    dry_run = args.dry_run or args.generate or not args.send

    if dry_run:
        print("🔍 Running in preview/dry-run mode - no messages will be sent")

    agent = OutreachAgent()
    result = await agent.run(
        service_slug=args.service,
        limit=args.limit,
        dry_run=dry_run,
    )

    # Print summary
    print("\n" + "=" * 60)
    print("OUTREACH SUMMARY")
    print("=" * 60)
    print(f"Total processed: {result.total_processed}")
    print(f"Successful:      {result.successful}")
    print(f"Failed:          {result.failed}")
    print(f"Skipped:         {result.skipped}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
