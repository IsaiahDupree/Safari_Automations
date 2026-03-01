#!/usr/bin/env python3
"""
scoring_agent.py — AAG Agent 03: ICP Scoring Agent

Reads newly discovered contacts, scores them 0-100 against the ideal customer
profile using Claude, and routes them to 'qualified' or 'archived'.

Features:
- Claude Haiku for cost-efficient scoring (batch & single)
- Score history tracking in crm_score_history
- Automatic routing based on ICP threshold
- Re-scoring of stale contacts
- Rich CLI with score distribution histogram

Usage:
    python3 scoring_agent.py --run
    python3 scoring_agent.py --limit 20 --niche-id UUID
    python3 scoring_agent.py --rescore-stale
    python3 scoring_agent.py --dry-run
"""

import argparse
import json
import sys
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

# Support both module and direct execution
if __name__ == "__main__" and __package__ is None:
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "acquisition"

from acquisition.config import ANTHROPIC_API_KEY, CLAUDE_MODEL_SCORING
from acquisition.db import queries

# ══════════════════════════════════════════════════════════════════════════════
# Default Scoring Prompt
# ══════════════════════════════════════════════════════════════════════════════

DEFAULT_SCORING_PROMPT = """Ideal customer: a business owner, coach, consultant, or creator who:
- Posts actively (at least weekly)
- Has 1,000–500,000 followers (not mega-celebrity, not micro-nano)
- Talks about growth, business, content strategy, or audience building
- Would benefit from AI-powered content or outreach automation
- Is NOT already a SaaS tool, agency, or competitor"""

# ══════════════════════════════════════════════════════════════════════════════
# Data Models
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class ScoreResult:
    score: int
    reasoning: str
    signals: list[str]


@dataclass
class ScoringResult:
    total_scored: int
    qualified_count: int
    archived_count: int
    score_distribution: dict[str, int]
    errors: list[str]


# ══════════════════════════════════════════════════════════════════════════════
# Claude Client
# ══════════════════════════════════════════════════════════════════════════════

def _call_claude(prompt: str, model: str = CLAUDE_MODEL_SCORING) -> tuple[Optional[str], Optional[str]]:
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
        "max_tokens": 1024,
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
# ScoringAgent
# ══════════════════════════════════════════════════════════════════════════════

class ScoringAgent:
    """Claude-powered ICP scoring agent."""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run

    async def run(
        self,
        limit: int = 50,
        niche_id: Optional[str] = None,
        rescore_stale: bool = False
    ) -> ScoringResult:
        """
        Score contacts and route them.

        Args:
            limit: Max contacts to process
            niche_id: Filter to specific niche config
            rescore_stale: Re-score contacts older than 30 days

        Returns:
            ScoringResult with counts and distribution
        """
        print(f"🎯 Scoring Agent starting...")
        print(f"   Mode: {'RESCORE STALE' if rescore_stale else 'NEW CONTACTS'}")
        print(f"   Limit: {limit}")
        if niche_id:
            print(f"   Niche: {niche_id}")
        if self.dry_run:
            print("   ⚠️  DRY RUN - no writes")
        print()

        # Fetch contacts
        contacts, err = queries.get_contacts_for_scoring(limit, niche_id, rescore_stale)
        if err:
            return ScoringResult(0, 0, 0, {}, [f"Failed to fetch contacts: {err}"])
        if not contacts:
            print("✅ No contacts to score.")
            return ScoringResult(0, 0, 0, {}, [])

        print(f"📋 Found {len(contacts)} contacts to score\n")

        # Group by niche to use correct scoring prompt
        by_niche: dict[str, list[dict]] = defaultdict(list)
        for contact in contacts:
            niche_id_key = contact.get("source_niche_config_id") or "default"
            by_niche[niche_id_key].append(contact)

        total_scored = 0
        qualified_count = 0
        archived_count = 0
        score_buckets = {"0-49": 0, "50-64": 0, "65-79": 0, "80-100": 0}
        errors = []

        # Process each niche group
        for niche_id_key, niche_contacts in by_niche.items():
            # Get niche config
            if niche_id_key == "default":
                config = {"icp_min_score": 65, "scoring_prompt": DEFAULT_SCORING_PROMPT}
            else:
                config_data, err = queries.get_niche_config(niche_id_key)
                if err or not config_data:
                    errors.append(f"Niche {niche_id_key}: config not found")
                    continue
                config = config_data

            scoring_prompt = config.get("scoring_prompt") or DEFAULT_SCORING_PROMPT
            min_score = config.get("icp_min_score", 65)

            print(f"📊 Scoring {len(niche_contacts)} contacts for niche: {config.get('name', niche_id_key)}")
            print(f"   Min score: {min_score}\n")

            # Batch process (20 at a time)
            for i in range(0, len(niche_contacts), 20):
                batch = niche_contacts[i:i + 20]
                batch_results = await self.batch_score(batch, scoring_prompt)

                # Process results
                for contact, result in zip(batch, batch_results):
                    if result is None:
                        errors.append(f"Failed to score {contact['id']}")
                        continue

                    contact_id = contact["id"]
                    score = result.score

                    # Track distribution
                    if score < 50:
                        score_buckets["0-49"] += 1
                    elif score < 65:
                        score_buckets["50-64"] += 1
                    elif score < 80:
                        score_buckets["65-79"] += 1
                    else:
                        score_buckets["80-100"] += 1

                    # Write score history
                    if not self.dry_run:
                        _, err = queries.insert_score_history(
                            contact_id=contact_id,
                            score=score,
                            reasoning=result.reasoning,
                            signals=result.signals,
                            model_used=CLAUDE_MODEL_SCORING
                        )
                        if err:
                            errors.append(f"Failed to save score for {contact_id}: {err}")
                            continue

                    # Route contact
                    new_stage = await self.route_contact(contact_id, score, min_score)
                    if new_stage == "qualified":
                        qualified_count += 1
                    elif new_stage == "archived":
                        archived_count += 1

                    total_scored += 1

                    # Display
                    emoji = "✅" if new_stage == "qualified" else "❌"
                    print(f"   {emoji} {contact.get('display_name', 'Unknown')} → {score}/100 → {new_stage}")
                    if result.reasoning:
                        print(f"      💭 {result.reasoning[:80]}...")

        # Summary
        print("\n" + "="*60)
        print(f"📈 Scoring Complete")
        print(f"   Total scored: {total_scored}")
        print(f"   Qualified: {qualified_count}")
        print(f"   Archived: {archived_count}")
        print(f"\n📊 Score Distribution:")
        print(f"   0-49:    {score_buckets['0-49']:3d} {'█' * score_buckets['0-49']}")
        print(f"   50-64:   {score_buckets['50-64']:3d} {'█' * score_buckets['50-64']}")
        print(f"   65-79:   {score_buckets['65-79']:3d} {'█' * score_buckets['65-79']}")
        print(f"   80-100:  {score_buckets['80-100']:3d} {'█' * score_buckets['80-100']}")

        if errors:
            print(f"\n⚠️  {len(errors)} errors occurred:")
            for err in errors[:5]:
                print(f"   - {err}")

        return ScoringResult(
            total_scored=total_scored,
            qualified_count=qualified_count,
            archived_count=archived_count,
            score_distribution=score_buckets,
            errors=errors
        )

    async def score_contact(self, contact: dict, scoring_prompt: str) -> Optional[ScoreResult]:
        """
        Score a single contact using Claude.

        Args:
            contact: Contact dict from crm_contacts
            scoring_prompt: ICP criteria text

        Returns:
            ScoreResult or None if parsing fails
        """
        # Build prompt
        prompt = f"""You are scoring a social media prospect against an ideal customer profile.

ICP Criteria:
{scoring_prompt}

Contact:
- Name: {contact.get('display_name', 'Unknown')}
- Platform: {contact.get('platform', 'unknown')} (@{contact.get('handle', 'unknown')})
- Followers: {contact.get('follower_count', 0):,}
- Bio: {contact.get('bio_text', 'N/A')[:200]}
- Top post: "{contact.get('top_post_text', 'N/A')[:150]}" ({contact.get('top_post_likes', 0)} likes)
- Niche: {contact.get('niche_label', 'unknown')}

Score this contact 0-100 where:
100 = perfect ICP match
70+ = qualified, worth outreach
50-69 = borderline
<50 = not a fit

Respond with valid JSON only:
{{"score": <int>, "reasoning": "<one sentence>", "signals": ["<signal1>", "<signal2>"]}}"""

        # Call Claude
        response, err = _call_claude(prompt)
        if err:
            print(f"   ⚠️  Claude error: {err}")
            return None

        # Parse JSON
        try:
            # Extract JSON from markdown code blocks if present
            response_clean = response.strip()
            if response_clean.startswith("```"):
                lines = response_clean.split("\n")
                response_clean = "\n".join(lines[1:-1]) if len(lines) > 2 else response_clean

            data = json.loads(response_clean)
            return ScoreResult(
                score=int(data["score"]),
                reasoning=data.get("reasoning", ""),
                signals=data.get("signals", [])
            )
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f"   ⚠️  Failed to parse Claude response: {e}")
            print(f"       Raw: {response[:100]}")
            return None

    async def batch_score(
        self,
        contacts: list[dict],
        scoring_prompt: str
    ) -> list[Optional[ScoreResult]]:
        """
        Score multiple contacts in a single Claude call (up to 20).

        Args:
            contacts: List of contact dicts
            scoring_prompt: ICP criteria

        Returns:
            List of ScoreResult (or None for failed parses), same order as input
        """
        if len(contacts) == 1:
            result = await self.score_contact(contacts[0], scoring_prompt)
            return [result]

        # Build batch prompt
        contacts_text = ""
        for i, c in enumerate(contacts):
            contacts_text += f"""
{i}. {c.get('display_name', 'Unknown')} (@{c.get('handle', 'unknown')})
   Platform: {c.get('platform', 'unknown')} | Followers: {c.get('follower_count', 0):,}
   Bio: {c.get('bio_text', 'N/A')[:150]}
   Top post: "{c.get('top_post_text', 'N/A')[:100]}" ({c.get('top_post_likes', 0)} likes)
"""

        prompt = f"""Score each of these {len(contacts)} contacts against the ICP. Return a JSON array with one object per contact in order.

ICP Criteria:
{scoring_prompt}

Contacts:
{contacts_text}

Each object must have: {{"contact_index": <int>, "score": <int>, "reasoning": "<one sentence>"}}

Respond with JSON array only."""

        # Call Claude
        response, err = _call_claude(prompt)
        if err:
            print(f"   ⚠️  Batch scoring failed, falling back to individual: {err}")
            # Fallback to individual scoring
            results = []
            for contact in contacts:
                result = await self.score_contact(contact, scoring_prompt)
                results.append(result)
            return results

        # Parse batch response
        try:
            # Extract JSON from markdown code blocks
            response_clean = response.strip()
            if response_clean.startswith("```"):
                lines = response_clean.split("\n")
                response_clean = "\n".join(lines[1:-1]) if len(lines) > 2 else response_clean

            batch_data = json.loads(response_clean)

            # Map to results array
            results: list[Optional[ScoreResult]] = [None] * len(contacts)
            for item in batch_data:
                idx = int(item["contact_index"])
                if 0 <= idx < len(contacts):
                    results[idx] = ScoreResult(
                        score=int(item["score"]),
                        reasoning=item.get("reasoning", ""),
                        signals=item.get("signals", [])
                    )

            return results

        except (json.JSONDecodeError, KeyError, ValueError, IndexError) as e:
            print(f"   ⚠️  Batch parse failed, falling back to individual: {e}")
            # Fallback to individual scoring
            results = []
            for contact in contacts:
                result = await self.score_contact(contact, scoring_prompt)
                results.append(result)
            return results

    async def route_contact(self, contact_id: str, score: int, min_score: int) -> str:
        """
        Route contact based on score.

        Args:
            contact_id: Contact UUID
            score: ICP score 0-100
            min_score: Minimum qualifying score

        Returns:
            New pipeline stage ('qualified' or 'archived')
        """
        new_stage = "qualified" if score >= min_score else "archived"

        if not self.dry_run:
            _, err = queries.update_pipeline_stage(
                contact_id=contact_id,
                new_stage=new_stage,
                triggered_by="scoring_agent"
            )
            if err:
                print(f"   ⚠️  Failed to update stage: {err}")

        return new_stage


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

async def main():
    parser = argparse.ArgumentParser(description="AAG Agent 03: ICP Scoring Agent")
    parser.add_argument("--run", action="store_true", help="Run the scoring agent")
    parser.add_argument("--limit", type=int, default=50, help="Max contacts to process")
    parser.add_argument("--niche-id", type=str, help="Filter to specific niche UUID")
    parser.add_argument("--rescore-stale", action="store_true", help="Re-score contacts older than 30 days")
    parser.add_argument("--dry-run", action="store_true", help="Show scores but don't write to DB")

    args = parser.parse_args()

    if not args.run:
        parser.print_help()
        return

    agent = ScoringAgent(dry_run=args.dry_run)
    result = await agent.run(
        limit=args.limit,
        niche_id=args.niche_id,
        rescore_stale=args.rescore_stale
    )

    # Exit code
    sys.exit(0 if not result.errors else 1)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
