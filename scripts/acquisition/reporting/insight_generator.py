"""
acquisition/reporting/insight_generator.py — Generate actionable insights using Claude.

Analyzes weekly statistics and generates data-backed recommendations
for improving the acquisition pipeline.
"""
import json
import urllib.request
import urllib.error
from dataclasses import dataclass
from typing import Optional

from ..config import ANTHROPIC_API_KEY
from .stats_collector import WeeklyStats


@dataclass
class Insight:
    """A single actionable insight derived from data analysis."""
    observation: str
    evidence: str
    recommended_action: str
    confidence: int  # 0-100

    def to_dict(self) -> dict:
        return {
            "observation": self.observation,
            "evidence": self.evidence,
            "recommended_action": self.recommended_action,
            "confidence": self.confidence,
        }


def generate_insights(stats: WeeklyStats) -> tuple[list[Insight], Optional[str]]:
    """
    Use Claude to analyze weekly stats and generate actionable insights.

    Returns:
        (list[Insight], None) on success
        ([], error_message) on failure
    """
    if not ANTHROPIC_API_KEY:
        return [], "ANTHROPIC_API_KEY not configured"

    # Build variant summary
    variant_summary = "N/A"
    if stats.variant_stats:
        best_variant = stats.variant_stats[0]
        variant_summary = f"{best_variant.get('name', 'Unknown')} ({best_variant.get('reply_rate', 0):.1%} reply rate, {best_variant.get('sends', 0)} sends)"

    # Format email stats
    email_open_rate = stats.email_stats.get('open_rate', 'N/A')
    if isinstance(email_open_rate, (int, float)):
        email_open_rate = f"{email_open_rate:.1%}"

    # Format warmup analytics
    warmup_summary = "N/A"
    if stats.warmup_analytics and stats.warmup_analytics.get("sample_size", 0) > 0:
        wa = stats.warmup_analytics
        warmup_summary = f"{wa.get('correlation', 'unknown')} correlation (sample: {wa.get('sample_size', 0)} contacts)"
        if "recommendation" in wa:
            warmup_summary += f" — {wa['recommendation']}"

    # Build prompt
    prompt = f"""You are analyzing acquisition pipeline performance data to generate actionable insights.

This week's data:
- Discovered: {stats.discovered} prospects (prev week: {stats.prev_discovered})
- Qualify rate: {stats.qualify_rate:.1%} (prev: {stats.prev_qualify_rate:.1%})
- Outreach sent: {stats.dms_sent} DMs + {stats.emails_sent} emails = {stats.dms_sent + stats.emails_sent} total
- Reply rate: {stats.reply_rate:.1%} (prev: {stats.prev_reply_rate:.1%})
- Calls booked: {stats.calls_booked}
- Closed won: {stats.closed_won}
- Top platform by reply rate: {stats.top_platform}
- Top niche: {stats.top_niche}
- Email reply rate: {stats.email_reply_rate:.1%}
- Best message variant: {variant_summary}
- Warmup analytics: {warmup_summary}
- Pipeline snapshot: {json.dumps(stats.pipeline_snapshot)}

Generate 3-5 specific, actionable insights. Each must have:
1. An observation based directly on the data
2. Evidence (cite specific numbers)
3. A concrete recommended action
4. A confidence score (0-100) based on sample size and effect size

Format as JSON array:
[{{"observation": "...", "evidence": "...", "recommended_action": "...", "confidence": 85}}]

Be specific — "Twitter has 29% reply rate vs 14% Instagram" not "Twitter performs better."
Only recommend actions supported by the data.
If sample sizes are too small (<10), note low confidence.
Focus on HIGH-IMPACT insights that could materially improve conversion rates."""

    # Call Claude API
    try:
        request_body = {
            "model": "claude-sonnet-4-5-20250929",
            "max_tokens": 1500,
            "messages": [{"role": "user", "content": prompt}]
        }

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(request_body).encode(),
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=30) as response:
            response_data = json.loads(response.read())
            content = response_data.get("content", [])
            if not content:
                return [], "No content in Claude response"

            # Extract text from response
            text = content[0].get("text", "")
            if not text:
                return [], "Empty text in Claude response"

            # Parse JSON array from text
            # Claude might wrap it in markdown code blocks, so clean it
            text = text.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

            insights_data = json.loads(text)
            insights = [Insight(**item) for item in insights_data]
            return insights, None

    except urllib.error.HTTPError as e:
        err_body = e.read().decode()[:500]
        return [], f"HTTP {e.code}: {err_body}"
    except json.JSONDecodeError as e:
        return [], f"Failed to parse JSON response: {str(e)}"
    except Exception as e:
        return [], f"Error calling Claude API: {str(e)}"


def update_variant_performance() -> tuple[list[str], Optional[str]]:
    """
    Track variant performance and automatically flag winners.

    Returns:
        (list of actions taken, None) on success
        ([], error_message) on failure
    """
    from ..db import queries

    actions = []

    # Get all active variants
    variants, err = queries.get_variant_performance()
    if err:
        return [], err

    if not variants:
        return [], None

    # Filter to active only
    active_variants = [v for v in variants if v.get('is_active')]
    if not active_variants:
        return [], None

    # Find best performer
    best = max(active_variants, key=lambda v: v.get('reply_rate', 0))
    best_rate = best.get('reply_rate', 0)
    best_sends = best.get('sends', 0)

    # Check if we have enough data and a clear winner
    if best_sends < 10:
        return ["Insufficient data (need 10+ sends for best variant)"], None

    # Flag winner if one variant has 2x reply rate with enough samples
    for variant in active_variants:
        if variant['id'] == best['id']:
            continue

        variant_sends = variant.get('sends', 0)
        variant_rate = variant.get('reply_rate', 0)

        # Need at least 5 samples for comparison
        if variant_sends < 5:
            continue

        # If best is 2x better, mark it as winner and deactivate loser
        if best_rate >= variant_rate * 2:
            _, err = queries.mark_variant_winner(best['id'])
            if err:
                return actions, err
            actions.append(f"Marked variant '{best.get('name')}' as winner ({best_rate:.1%} vs {variant_rate:.1%})")

            _, err = queries.deactivate_variant(variant['id'])
            if err:
                return actions, err
            actions.append(f"Deactivated variant '{variant.get('name')}' (underperforming)")

    return actions, None


def auto_apply_insights(insights: list[Insight], dry_run: bool = True) -> tuple[list[str], Optional[str]]:
    """
    Automatically apply high-confidence insights to the pipeline config.

    Args:
        insights: List of insights to potentially apply
        dry_run: If True, only return what would be applied (don't make changes)

    Returns:
        (list of applied changes, None) on success
        ([], error_message) on failure
    """
    from ..db import queries
    import re

    applied = []

    for insight in insights:
        action = insight.recommended_action.lower()

        # Only auto-apply high-confidence insights (>=75)
        if insight.confidence < 75:
            continue

        # Pattern: "Raise ICP min_score to X"
        if 'raise' in action and 'score' in action:
            match = re.search(r'(\d+)', action)
            if match:
                new_threshold = int(match.group(1))
                # Sanity bounds: 60-85 is reasonable for min_score
                if 60 <= new_threshold <= 85:
                    if not dry_run:
                        _, err = queries.update_all_niche_min_scores(new_threshold)
                        if err:
                            return applied, err
                    applied.append(f"Raised ICP min_score to {new_threshold}")

        # Pattern: "Lower ICP min_score to X"
        if 'lower' in action and 'score' in action:
            match = re.search(r'(\d+)', action)
            if match:
                new_threshold = int(match.group(1))
                if 60 <= new_threshold <= 85:
                    if not dry_run:
                        _, err = queries.update_all_niche_min_scores(new_threshold)
                        if err:
                            return applied, err
                    applied.append(f"Lowered ICP min_score to {new_threshold}")

        # Pattern: "Promote winning variant" or "Make variant X default"
        if 'variant' in action and ('promote' in action or 'default' in action or 'winner' in action):
            if not dry_run:
                _, err = queries.promote_winning_variant()
                if err:
                    return applied, err
            applied.append("Promoted winning message variant to default")

        # Pattern: "Focus on [platform]" or "Increase [platform] outreach"
        if 'focus on' in action or 'increase' in action:
            platforms = ['instagram', 'twitter', 'linkedin', 'tiktok']
            for platform in platforms:
                if platform in action:
                    # This would require per-platform daily caps adjustment
                    # For now, just log it
                    applied.append(f"Recommendation: Increase {platform} focus (manual action needed)")

    return applied, None
