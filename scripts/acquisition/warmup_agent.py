#!/usr/bin/env python3
"""
warmup_agent.py — AAG Agent 04: Engagement Warmup Agent

Schedules and sends platform comments on prospects' posts before DM outreach.
Comments build recognition so the first DM feels familiar, not cold.

Features:
- Auto-scheduling of warmup comments for qualified contacts
- Spreads comments across window_days with smart timing
- AI-generated insightful comments (Claude Haiku)
- High-score skip logic for prospects who don't need warmup
- Completion tracking and stage advancement
- Duplicate/same-day guards

Usage:
    python3 warmup_agent.py --schedule     # create schedules for qualified contacts
    python3 warmup_agent.py --execute      # send pending comments
    python3 warmup_agent.py --status       # show pipeline state
    python3 warmup_agent.py --platform twitter  # execute only twitter
    python3 warmup_agent.py --dry-run
"""

import argparse
import json
import random
import sys
import urllib.request
import urllib.error
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

# Support both module and direct execution
if __name__ == "__main__" and __package__ is None:
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "acquisition"

from acquisition.config import (
    ANTHROPIC_API_KEY,
    CLAUDE_MODEL_GENERATION,
    COMMENT_SERVICE_PORTS,
    MARKET_RESEARCH_PORT,
    WARMUP_COMMENTS_TARGET,
    WARMUP_WINDOW_DAYS,
    WARMUP_MIN_GAP_HOURS,
)
from acquisition.db import queries

# ══════════════════════════════════════════════════════════════════════════════
# Constants
# ══════════════════════════════════════════════════════════════════════════════

COMMENT_TONES = {
    "insightful": "Add a thoughtful observation or insight related to the post",
    "encouraging": "Affirm their point and add positivity",
    "curious": "Ask a relevant, non-generic question about the topic",
}

# ══════════════════════════════════════════════════════════════════════════════
# Data Models
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class PostData:
    """Social media post data."""
    url: str
    text: str
    platform: str
    author_handle: str
    likes: int = 0


@dataclass
class WarmupConfig:
    """Warmup configuration for a niche."""
    comments_target: int = WARMUP_COMMENTS_TARGET
    window_days: int = WARMUP_WINDOW_DAYS
    min_gap_hours: int = WARMUP_MIN_GAP_HOURS
    skip_warmup_min_score: int = 85
    comment_tone: str = "insightful"
    use_ai_comments: bool = True


@dataclass
class ScheduleResult:
    """Result from scheduling warmup comments."""
    contacts_processed: int
    schedules_created: int
    high_score_skips: int
    errors: list[str]


@dataclass
class ExecuteResult:
    """Result from executing pending warmup comments."""
    comments_sent: int
    comments_failed: int
    contacts_completed: int
    rate_limit_skips: int
    errors: list[str]


# ══════════════════════════════════════════════════════════════════════════════
# Claude Client
# ══════════════════════════════════════════════════════════════════════════════

def _call_claude(prompt: str, model: str = CLAUDE_MODEL_GENERATION) -> tuple[Optional[str], Optional[str]]:
    """Call Claude API and return (response_text, error)."""
    if not ANTHROPIC_API_KEY:
        return None, "ANTHROPIC_API_KEY not set"

    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": model,
        "max_tokens": 256,
        "messages": [{"role": "user", "content": prompt}]
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode(),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            text = data["content"][0]["text"]
            return text, None
    except Exception as e:
        return None, f"Claude API error: {str(e)[:200]}"


# ══════════════════════════════════════════════════════════════════════════════
# Comment Service Client
# ══════════════════════════════════════════════════════════════════════════════

async def send_comment(
    platform: str,
    post_url: str,
    comment_text: str
) -> tuple[Optional[str], Optional[str]]:
    """
    Send comment via platform service.

    Returns:
        (comment_id, error)
    """
    port = COMMENT_SERVICE_PORTS.get(platform)
    if not port:
        return None, f"No comment service for platform: {platform}"

    url = f"http://localhost:{port}/api/{platform}/comments/post"
    body = {"postUrl": post_url, "text": comment_text}

    try:
        data = json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read())
            if result.get("success"):
                return result.get("commentId"), None
            else:
                return None, result.get("error", "Unknown error")

    except urllib.error.HTTPError as e:
        err_body = e.read().decode()[:300]
        return None, f"HTTP {e.code}: {err_body}"
    except Exception as e:
        return None, f"Request failed: {str(e)[:200]}"


# ══════════════════════════════════════════════════════════════════════════════
# Post Search Client
# ══════════════════════════════════════════════════════════════════════════════

async def search_posts(platform: str, handle: str, max_results: int = 5) -> tuple[list[PostData], Optional[str]]:
    """
    Search for recent posts by a handle.

    Returns:
        (list of PostData, error)
    """
    url = f"http://localhost:{MARKET_RESEARCH_PORT}/api/research/{platform}/search"
    body = {"keyword": f"@{handle}", "maxResults": max_results}

    try:
        data = json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read())
            posts = []
            for post in result.get("posts", []):
                posts.append(PostData(
                    url=post.get("url", ""),
                    text=post.get("text", ""),
                    platform=platform,
                    author_handle=handle,
                    likes=post.get("likes", 0)
                ))
            return posts, None

    except Exception as e:
        return [], f"Post search failed: {str(e)[:200]}"


# ══════════════════════════════════════════════════════════════════════════════
# WarmupAgent
# ══════════════════════════════════════════════════════════════════════════════

class WarmupAgent:
    """Warmup agent that schedules and sends comment engagements."""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run

    async def schedule_batch(self, limit: int = 50) -> ScheduleResult:
        """
        Create warmup schedules for qualified contacts.

        Reads all pipeline_stage='qualified' contacts not yet in acq_warmup_schedules,
        creates schedule rows, and advances them to 'warming' stage.

        Args:
            limit: Max contacts to process

        Returns:
            ScheduleResult with counts and errors
        """
        print("📅 Warmup Scheduler starting...")
        if self.dry_run:
            print("   ⚠️  DRY RUN - no writes")
        print()

        # Fetch qualified contacts
        contacts, err = queries.get_qualified_contacts(limit)
        if err:
            return ScheduleResult(0, 0, 0, [f"Failed to fetch contacts: {err}"])
        if not contacts:
            print("✅ No qualified contacts to schedule.")
            return ScheduleResult(0, 0, 0, [])

        print(f"📋 Found {len(contacts)} qualified contacts\n")

        contacts_processed = 0
        schedules_created = 0
        high_score_skips = 0
        errors = []

        for contact in contacts:
            contact_id = contact["id"]
            display_name = contact.get("display_name", "Unknown")
            platform = contact.get("platform", "unknown")
            handle = contact.get("handle", "unknown")
            score = contact.get("relationship_score", 0)
            niche_id = contact.get("source_niche_config_id")

            # Get warmup config
            config = await self._get_warmup_config(niche_id)

            # High-score skip check
            if score >= config.skip_warmup_min_score:
                print(f"   ⭐ {display_name} ({score}) — skip warmup (high score)")
                if not self.dry_run:
                    _, err = queries.update_pipeline_stage(
                        contact_id,
                        "ready_for_dm",
                        triggered_by="warmup_agent"
                    )
                    if err:
                        errors.append(f"{contact_id}: failed to advance: {err}")
                        continue
                    # Record metadata for high-score skip
                    _, err = queries.insert_funnel_event(
                        contact_id,
                        "qualified",
                        "ready_for_dm",
                        "warmup_agent",
                        metadata={"reason": "high_score_skip", "score": score}
                    )
                high_score_skips += 1
                contacts_processed += 1
                continue

            # Get posts for this contact
            posts, err = await self._get_posts_for_contact(contact, config.comments_target + 1)
            if err or not posts:
                print(f"   ⚠️  {display_name} — no posts found")
                errors.append(f"{contact_id}: no posts available")
                continue

            # Check if already scheduled (shouldn't happen but defensive)
            existing, _ = queries._select(
                "acq_warmup_schedules",
                f"?contact_id=eq.{contact_id}&status=in.(pending,sent)"
            )
            if existing:
                print(f"   ⏭️  {display_name} — already has schedules")
                continue

            # Create schedules spread over window
            created_count = await self._create_schedules(
                contact_id,
                posts[:config.comments_target],
                config
            )

            if created_count > 0:
                # Advance to 'warming' stage
                if not self.dry_run:
                    _, err = queries.update_pipeline_stage(
                        contact_id,
                        "warming",
                        triggered_by="warmup_agent"
                    )
                    if err:
                        errors.append(f"{contact_id}: failed to advance: {err}")
                        continue

                schedules_created += created_count
                contacts_processed += 1
                print(f"   ✅ {display_name} — {created_count} comments scheduled")

        # Summary
        print("\n" + "="*60)
        print(f"📊 Scheduling Complete")
        print(f"   Contacts processed: {contacts_processed}")
        print(f"   Schedules created: {schedules_created}")
        print(f"   High-score skips: {high_score_skips}")
        if errors:
            print(f"   ⚠️  Errors: {len(errors)}")

        return ScheduleResult(
            contacts_processed=contacts_processed,
            schedules_created=schedules_created,
            high_score_skips=high_score_skips,
            errors=errors
        )

    async def execute_pending(self, platform: Optional[str] = None, limit: int = 50) -> ExecuteResult:
        """
        Execute pending warmup comment schedules.

        Reads acq_warmup_schedules WHERE status='pending' AND scheduled_at <= NOW(),
        sends comments, updates rows, checks for completion.

        Args:
            platform: Filter to specific platform (optional)
            limit: Max schedules to process

        Returns:
            ExecuteResult with counts and errors
        """
        print("💬 Warmup Executor starting...")
        if platform:
            print(f"   Platform filter: {platform}")
        if self.dry_run:
            print("   ⚠️  DRY RUN - no sends")
        print()

        # Fetch pending schedules
        schedules, err = queries.get_pending_warmup(limit)
        if err:
            return ExecuteResult(0, 0, 0, 0, [f"Failed to fetch schedules: {err}"])
        if not schedules:
            print("✅ No pending schedules to execute.")
            return ExecuteResult(0, 0, 0, 0, [])

        # Filter by platform if specified
        if platform:
            schedules = [s for s in schedules if s.get("platform") == platform]

        print(f"📋 Found {len(schedules)} pending schedules\n")

        comments_sent = 0
        comments_failed = 0
        contacts_completed = 0
        rate_limit_skips = 0
        errors = []
        processed_contacts = set()

        for schedule in schedules:
            schedule_id = schedule["id"]
            contact_id = schedule["contact_id"]
            sched_platform = schedule["platform"]
            post_url = schedule.get("post_url", "")
            comment_text = schedule.get("comment_text")

            # Get contact info for display
            contact, _ = queries.get_contact(contact_id)
            display_name = contact.get("display_name", "Unknown") if contact else "Unknown"

            # Check daily cap
            can_send, err = queries.check_daily_cap("comment", sched_platform)
            if err:
                errors.append(f"{schedule_id}: cap check error: {err}")
                continue
            if not can_send:
                print(f"   ⏸️  {display_name} — daily cap reached for {sched_platform}")
                # Reschedule to tomorrow
                if not self.dry_run:
                    tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
                    _, err = queries.update_warmup_status(
                        schedule_id,
                        "pending",
                        scheduled_at=tomorrow.isoformat(),
                        skip_reason="daily_cap_reached"
                    )
                rate_limit_skips += 1
                continue

            # Generate comment if not pre-generated
            if not comment_text:
                comment_text, err = await self._generate_comment_for_schedule(schedule)
                if err:
                    print(f"   ⚠️  {display_name} — comment generation failed: {err}")
                    errors.append(f"{schedule_id}: generation failed")
                    comments_failed += 1
                    if not self.dry_run:
                        _, _ = queries.update_warmup_status(schedule_id, "failed", skip_reason=err)
                    continue

            # Send comment
            if not self.dry_run:
                comment_id, err = await send_comment(sched_platform, post_url, comment_text)
                if err:
                    print(f"   ❌ {display_name} — send failed: {err}")
                    errors.append(f"{schedule_id}: send failed: {err}")
                    comments_failed += 1
                    _, _ = queries.update_warmup_status(schedule_id, "failed", skip_reason=err)
                    continue

                # Update schedule to sent
                _, err = queries.update_warmup_status(
                    schedule_id,
                    "sent",
                    comment_id=comment_id,
                    comment_text=comment_text
                )
                if err:
                    errors.append(f"{schedule_id}: update failed: {err}")

                # Record in crm_messages
                _, err = queries.insert_crm_message(
                    contact_id=contact_id,
                    message_type="comment",
                    is_outbound=True,
                    message_text=comment_text,
                    sent_at=queries._utcnow()
                )

                # Increment daily cap
                _, err = queries.increment_daily_cap("comment", sched_platform)

            print(f"   ✅ {display_name} — comment sent on {sched_platform}")
            comments_sent += 1

            # Check completion
            if not self.dry_run and contact_id not in processed_contacts:
                completed = await self._check_completion(contact_id)
                if completed:
                    contacts_completed += 1
                    print(f"      🎯 {display_name} → ready_for_dm (warmup complete)")
                processed_contacts.add(contact_id)

        # Summary
        print("\n" + "="*60)
        print(f"📊 Execution Complete")
        print(f"   Comments sent: {comments_sent}")
        print(f"   Comments failed: {comments_failed}")
        print(f"   Contacts completed: {contacts_completed}")
        print(f"   Rate limit skips: {rate_limit_skips}")
        if errors:
            print(f"   ⚠️  Errors: {len(errors)}")

        return ExecuteResult(
            comments_sent=comments_sent,
            comments_failed=comments_failed,
            contacts_completed=contacts_completed,
            rate_limit_skips=rate_limit_skips,
            errors=errors
        )

    async def show_status(self):
        """Display pipeline status."""
        print("📊 Warmup Agent Status")
        print("="*60)

        # Pipeline stage counts
        stages_of_interest = ["qualified", "warming", "ready_for_dm"]
        for stage in stages_of_interest:
            contacts, _ = queries.get_contacts_by_stage(stage, limit=1000)
            count = len(contacts) if contacts else 0
            print(f"   {stage:15s}: {count:4d}")

        # Pending schedules
        pending, _ = queries.get_pending_warmup(limit=1000)
        pending_count = len(pending) if pending else 0
        print(f"\n   Pending schedules: {pending_count}")

        # Recent completions (moved from warming to ready_for_dm today)
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        params = f"?from_stage=eq.warming&to_stage=eq.ready_for_dm&occurred_at=gte.{today_start.isoformat()}"
        events, _ = queries._select("acq_funnel_events", params)
        recent_completions = len(events) if events else 0
        print(f"   Completions today: {recent_completions}")

        print()

    # ──────────────────────────────────────────────────────────────────────────
    # Helper Methods
    # ──────────────────────────────────────────────────────────────────────────

    async def _get_warmup_config(self, niche_id: Optional[str]) -> WarmupConfig:
        """
        Get warmup config for a niche.

        Falls back to defaults if no custom config exists.
        """
        if not niche_id:
            return WarmupConfig()

        # Try to get custom config
        rows, _ = queries._select("acq_warmup_configs", f"?niche_config_id=eq.{niche_id}")
        if rows and len(rows) > 0:
            cfg = rows[0]
            return WarmupConfig(
                comments_target=cfg.get("comments_target", WARMUP_COMMENTS_TARGET),
                window_days=cfg.get("window_days", WARMUP_WINDOW_DAYS),
                min_gap_hours=cfg.get("min_gap_hours", WARMUP_MIN_GAP_HOURS),
                skip_warmup_min_score=85,  # from niche config
                comment_tone=cfg.get("comment_tone", "insightful"),
                use_ai_comments=cfg.get("use_ai_comments", True),
            )

        # Check niche config for skip_warmup_min_score
        niche, _ = queries.get_niche_config(niche_id)
        if niche:
            return WarmupConfig(
                skip_warmup_min_score=niche.get("skip_warmup_min_score", 85)
            )

        return WarmupConfig()

    async def _get_posts_for_contact(self, contact: dict, n: int = 3) -> tuple[list[PostData], Optional[str]]:
        """
        Get recent posts for a contact.

        First checks crm_market_research cache, falls back to API search.
        """
        platform = contact.get("platform", "")
        handle = contact.get("handle", "")

        # Try cache first (crm_market_research)
        # TODO: implement cache lookup when that table exists

        # Fall back to API search
        posts, err = await search_posts(platform, handle, max_results=n)
        if err:
            return [], err

        # Filter out posts we've already commented on
        contact_id = contact["id"]
        existing_schedules, _ = queries._select(
            "acq_warmup_schedules",
            f"?contact_id=eq.{contact_id}&select=post_url"
        )
        existing_urls = {s["post_url"] for s in (existing_schedules or [])}
        posts = [p for p in posts if p.url not in existing_urls]

        return posts, None

    async def _create_schedules(
        self,
        contact_id: str,
        posts: list[PostData],
        config: WarmupConfig
    ) -> int:
        """
        Create warmup schedule rows for a contact.

        Spreads comments over window_days, respects min_gap_hours, avoids same-day duplicates.
        """
        if not posts:
            return 0

        now = datetime.now(timezone.utc)
        schedules = []

        # Get existing schedules to check for same-day guard
        existing, _ = queries._select(
            "acq_warmup_schedules",
            f"?contact_id=eq.{contact_id}&select=scheduled_at"
        )
        existing_dates = {
            datetime.fromisoformat(s["scheduled_at"].replace("Z", "+00:00")).date()
            for s in (existing or [])
        }

        for i, post in enumerate(posts[:config.comments_target]):
            # Spread comments across window
            if config.comments_target > 1:
                day_offset = (i * config.window_days) / (config.comments_target - 1)
            else:
                day_offset = 0

            # Random hour between 8AM-6PM (business hours)
            random_hour = random.uniform(8, 18)
            scheduled_dt = now + timedelta(days=day_offset, hours=random_hour)

            # Same-day guard: if date already has a schedule, add 1 day
            while scheduled_dt.date() in existing_dates:
                scheduled_dt += timedelta(days=1)

            existing_dates.add(scheduled_dt.date())

            schedules.append({
                "contact_id": contact_id,
                "platform": post.platform,
                "post_url": post.url,
                "scheduled_at": scheduled_dt.isoformat(),
                "status": "pending",
            })

        if not self.dry_run:
            for schedule in schedules:
                _, err = queries.insert_warmup_schedule(schedule)
                if err:
                    print(f"   ⚠️  Failed to create schedule: {err}")
                    return len(schedules) - 1

        return len(schedules)

    async def _generate_comment(self, post: PostData, config: WarmupConfig, niche: str = "unknown") -> str:
        """
        Generate an AI comment for a post.

        Uses Claude to create a relevant, non-generic comment.
        """
        tone = config.comment_tone or "insightful"
        tone_instruction = COMMENT_TONES.get(tone, COMMENT_TONES["insightful"])

        # Extract platform-specific emoji rules
        allow_emojis = post.platform in ("tiktok", "instagram")
        emoji_rule = "Use 1-2 emojis if natural" if allow_emojis else "No emojis"

        prompt = f"""Generate a {tone} comment for this social media post.

Post: "{post.text[:300]}"
Platform: {post.platform}
Poster's niche: {niche}

Rules:
- 1-2 sentences only
- Specific to THIS post content (no generic praise)
- {tone_instruction}
- Never: "great post", "love this", "so true", anything that sounds bot-like
- {emoji_rule}
- No mentions of our service

Comment:"""

        response, err = _call_claude(prompt)
        if err:
            return f"Interesting perspective on {niche}!"  # Fallback

        # Clean up response (remove quotes, newlines)
        comment = response.strip().strip('"').strip("'").replace("\n", " ")
        return comment

    async def _generate_comment_for_schedule(self, schedule: dict) -> tuple[Optional[str], Optional[str]]:
        """Generate comment for a schedule row."""
        contact_id = schedule["contact_id"]
        post_url = schedule.get("post_url", "")
        platform = schedule.get("platform", "")

        # Get contact for niche info
        contact, err = queries.get_contact(contact_id)
        if err or not contact:
            return None, "Contact not found"

        niche_id = contact.get("source_niche_config_id")
        config = await self._get_warmup_config(niche_id)

        # Get niche name
        niche_name = "unknown"
        if niche_id:
            niche, _ = queries.get_niche_config(niche_id)
            if niche:
                niche_name = niche.get("name", "unknown")

        # Create minimal PostData for generation
        # In a real scenario, we'd need to fetch the post content or have it cached
        post = PostData(
            url=post_url,
            text="",  # We don't have the text cached, so generate generic
            platform=platform,
            author_handle=contact.get("handle", ""),
        )

        comment = await self._generate_comment(post, config, niche_name)
        return comment, None

    async def _check_completion(self, contact_id: str) -> bool:
        """
        Check if contact has completed warmup.

        Returns True if contact should advance to ready_for_dm.
        """
        contact, err = queries.get_contact(contact_id)
        if err or not contact:
            return False

        niche_id = contact.get("source_niche_config_id")
        config = await self._get_warmup_config(niche_id)

        # Count sent comments
        sent_schedules, _ = queries._select(
            "acq_warmup_schedules",
            f"?contact_id=eq.{contact_id}&status=eq.sent"
        )
        sent_count = len(sent_schedules) if sent_schedules else 0

        # Check target met
        if sent_count >= config.comments_target:
            await self._advance_to_ready_for_dm(contact_id, "target_met")
            return True

        # Check window timeout
        all_schedules, _ = queries._select(
            "acq_warmup_schedules",
            f"?contact_id=eq.{contact_id}&order=scheduled_at.asc"
        )
        if all_schedules:
            first_scheduled = datetime.fromisoformat(
                all_schedules[0]["scheduled_at"].replace("Z", "+00:00")
            )
            now = datetime.now(timezone.utc)
            if now > first_scheduled + timedelta(days=config.window_days):
                await self._advance_to_ready_for_dm(contact_id, "window_expired")
                return True

        return False

    async def _advance_to_ready_for_dm(self, contact_id: str, reason: str):
        """Advance contact from warming to ready_for_dm."""
        if self.dry_run:
            return

        _, err = queries.update_pipeline_stage(
            contact_id,
            "ready_for_dm",
            triggered_by="warmup_agent"
        )
        if err:
            print(f"   ⚠️  Failed to advance {contact_id}: {err}")
            return

        # Record reason in funnel event metadata
        _, _ = queries.insert_funnel_event(
            contact_id,
            "warming",
            "ready_for_dm",
            "warmup_agent",
            metadata={"reason": reason}
        )


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

async def main():
    parser = argparse.ArgumentParser(description="AAG Agent 04: Warmup Agent")
    parser.add_argument("--schedule", action="store_true", help="Schedule warmup comments for qualified contacts")
    parser.add_argument("--execute", action="store_true", help="Execute pending warmup comments")
    parser.add_argument("--status", action="store_true", help="Show pipeline status")
    parser.add_argument("--platform", type=str, help="Filter to specific platform")
    parser.add_argument("--limit", type=int, default=50, help="Max contacts/schedules to process")
    parser.add_argument("--dry-run", action="store_true", help="Dry run mode (no writes)")

    args = parser.parse_args()

    agent = WarmupAgent(dry_run=args.dry_run)

    if args.status:
        await agent.show_status()
    elif args.schedule:
        await agent.schedule_batch(limit=args.limit)
    elif args.execute:
        await agent.execute_pending(platform=args.platform, limit=args.limit)
    else:
        parser.print_help()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
