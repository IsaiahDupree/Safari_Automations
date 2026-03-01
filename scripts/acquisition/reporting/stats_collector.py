"""
acquisition/reporting/stats_collector.py — Collect weekly pipeline performance metrics.

Gathers funnel counts, conversion rates, platform/niche performance,
variant stats, and stage snapshots for weekly reporting.
"""
from dataclasses import dataclass, asdict
from datetime import datetime, date, timedelta
from typing import Optional

from ..db import queries


def safe_divide(numerator: float, denominator: float) -> float:
    """Safe division that returns 0 for division by zero."""
    return numerator / denominator if denominator > 0 else 0.0


@dataclass
class WeeklyStats:
    """Container for all weekly pipeline metrics."""
    week_start: date
    week_end: date

    # Funnel counts
    discovered: int
    qualified: int
    warmup_sent: int
    dms_sent: int
    emails_sent: int
    replies_received: int
    calls_booked: int
    closed_won: int

    # Stage snapshot (current)
    pipeline_snapshot: dict[str, int]

    # Conversion rates
    qualify_rate: float
    reply_rate: float
    email_reply_rate: float
    close_rate: float

    # Best performers
    top_platform: str
    top_niche: str

    # Comparison to previous week
    prev_discovered: int = 0
    prev_qualified: int = 0
    prev_qualify_rate: float = 0.0
    prev_reply_rate: float = 0.0

    # Channel breakdown
    dm_stats: dict = None
    email_stats: dict = None

    # Variant performance
    variant_stats: list[dict] = None

    # Warmup analytics
    warmup_analytics: dict = None

    def __post_init__(self):
        """Initialize nested dictionaries."""
        if self.dm_stats is None:
            self.dm_stats = {}
        if self.email_stats is None:
            self.email_stats = {}
        if self.variant_stats is None:
            self.variant_stats = []
        if self.warmup_analytics is None:
            self.warmup_analytics = {}

    def to_dict(self) -> dict:
        """Convert to dictionary, handling date serialization."""
        d = asdict(self)
        d['week_start'] = self.week_start.isoformat()
        d['week_end'] = self.week_end.isoformat()
        return d


def collect_weekly_stats(week_start: date) -> tuple[Optional[WeeklyStats], Optional[str]]:
    """
    Collect all pipeline statistics for the week starting at week_start.

    Returns:
        (WeeklyStats, None) on success
        (None, error_message) on failure
    """
    week_end = week_start + timedelta(days=7)
    week_start_dt = datetime.combine(week_start, datetime.min.time())
    week_end_dt = datetime.combine(week_end, datetime.min.time())

    # Previous week for comparison
    prev_week_start_dt = week_start_dt - timedelta(days=7)
    prev_week_end_dt = week_start_dt

    # Count funnel events this week
    discovered, err = queries.count_funnel_events(
        to_stage='scored',
        since=week_start_dt,
        until=week_end_dt
    )
    if err:
        return None, f"Error counting discovered: {err}"

    qualified, err = queries.count_funnel_events(
        to_stage='qualified',
        since=week_start_dt,
        until=week_end_dt
    )
    if err:
        return None, f"Error counting qualified: {err}"

    # Count previous week for comparison
    prev_discovered, _ = queries.count_funnel_events(
        to_stage='scored',
        since=prev_week_start_dt,
        until=prev_week_end_dt
    )

    prev_qualified, _ = queries.count_funnel_events(
        to_stage='qualified',
        since=prev_week_start_dt,
        until=prev_week_end_dt
    )

    # Count warmup actions (comments sent during warming stage)
    # Approximation: count funnel events TO warming stage
    warmup_sent, err = queries.count_funnel_events(
        to_stage='warming',
        since=week_start_dt,
        until=week_end_dt
    )
    if err:
        return None, f"Error counting warmup: {err}"

    # Count DMs sent this week
    dms_sent, err = queries.count_crm_messages(
        message_type='dm',
        is_outbound=True,
        since=week_start_dt,
        until=week_end_dt
    )
    if err:
        return None, f"Error counting DMs: {err}"

    # Count emails sent this week
    emails_sent, err = queries.count_crm_messages(
        message_type='email',
        is_outbound=True,
        since=week_start_dt,
        until=week_end_dt
    )
    if err:
        return None, f"Error counting emails: {err}"

    # Count replies (inbound messages with prior outbound)
    replies_received, err = queries.count_replies_this_week(week_start_dt, week_end_dt)
    if err:
        return None, f"Error counting replies: {err}"

    # Count calls booked
    calls_booked, err = queries.count_funnel_events(
        to_stage='call_booked',
        since=week_start_dt,
        until=week_end_dt
    )
    if err:
        return None, f"Error counting calls booked: {err}"

    # Count closed won
    closed_won, err = queries.count_funnel_events(
        to_stage='closed_won',
        since=week_start_dt,
        until=week_end_dt
    )
    if err:
        return None, f"Error counting closed won: {err}"

    # Get pipeline snapshot (current state)
    pipeline_snapshot, err = queries.get_pipeline_snapshot()
    if err:
        return None, f"Error getting pipeline snapshot: {err}"

    # Calculate conversion rates
    qualify_rate = safe_divide(qualified, discovered)
    total_outreach = dms_sent + emails_sent
    reply_rate = safe_divide(replies_received, total_outreach)
    email_reply_rate = safe_divide(replies_received, emails_sent) if emails_sent > 0 else 0.0
    close_rate = safe_divide(closed_won, replies_received)

    # Previous week rates
    prev_total_outreach, _ = queries.count_crm_messages(
        is_outbound=True,
        since=prev_week_start_dt,
        until=prev_week_end_dt
    )
    prev_replies, _ = queries.count_replies_this_week(prev_week_start_dt, prev_week_end_dt)
    prev_qualify_rate = safe_divide(prev_qualified, prev_discovered)
    prev_reply_rate = safe_divide(prev_replies, prev_total_outreach)

    # Get top platform by reply rate
    top_platform, err = queries.get_top_platform_by_reply_rate(week_start_dt, week_end_dt)
    if err:
        top_platform = "unknown"

    # Get top niche by reply rate
    top_niche, err = queries.get_top_niche_by_reply_rate(week_start_dt, week_end_dt)
    if err:
        top_niche = "unknown"

    # Get variant performance
    variant_stats, err = queries.get_variant_performance()
    if err:
        variant_stats = []

    # Get warmup analytics
    warmup_analytics, err = get_warmup_analytics(since_days=30)
    if err:
        warmup_analytics = {
            "correlation": "error",
            "sample_size": 0,
            "recommendation": f"Error calculating warmup analytics: {err}"
        }

    # Build channel breakdown stats
    dm_stats = {
        "sent": dms_sent,
        "platform_breakdown": {
            # Could expand this with per-platform DM counts
        }
    }

    # Get detailed email metrics
    email_sequences, _ = queries._select(
        "acq_email_sequences",
        f"?status=eq.sent&sent_at=gte.{week_start_dt.isoformat()}&sent_at=lte.{week_end_dt.isoformat()}&select=subject,opened_at,clicked_at,resend_id"
    )

    if email_sequences:
        total_email_sequences = len(email_sequences)
        opened_count = sum(1 for e in email_sequences if e.get("opened_at"))
        clicked_count = sum(1 for e in email_sequences if e.get("clicked_at"))
        email_open_rate = safe_divide(opened_count, total_email_sequences)
        email_click_rate = safe_divide(clicked_count, total_email_sequences)

        # Get bounce rate
        bounced, _ = queries._select(
            "acq_email_sequences",
            f"?status=eq.bounced&updated_at=gte.{week_start_dt.isoformat()}&updated_at=lte.{week_end_dt.isoformat()}&select=id"
        )
        bounce_count = len(bounced) if bounced else 0
        email_bounce_rate = safe_divide(bounce_count, total_email_sequences)

        # Get best performing subject lines (by open rate)
        subject_performance = {}
        for seq in email_sequences:
            subject = seq.get("subject", "")
            if subject:
                if subject not in subject_performance:
                    subject_performance[subject] = {"sent": 0, "opened": 0}
                subject_performance[subject]["sent"] += 1
                if seq.get("opened_at"):
                    subject_performance[subject]["opened"] += 1

        # Calculate open rates for each subject and get top 3
        subject_rates = []
        for subject, stats in subject_performance.items():
            if stats["sent"] >= 2:  # Only include subjects sent at least twice
                open_rate = safe_divide(stats["opened"], stats["sent"])
                subject_rates.append({
                    "subject": subject,
                    "sent": stats["sent"],
                    "open_rate": open_rate
                })

        subject_rates.sort(key=lambda x: x["open_rate"], reverse=True)
        best_subjects = subject_rates[:3]
    else:
        email_open_rate = 0.0
        email_click_rate = 0.0
        email_bounce_rate = 0.0
        best_subjects = []

    email_stats = {
        "sent": emails_sent,
        "reply_rate": email_reply_rate,
        "open_rate": email_open_rate,
        "click_rate": email_click_rate,
        "bounce_rate": email_bounce_rate,
        "best_subjects": best_subjects,
        "bounce_alert": email_bounce_rate > 0.05,  # Alert if >5%
    }

    return WeeklyStats(
        week_start=week_start,
        week_end=week_end,
        discovered=discovered,
        qualified=qualified,
        warmup_sent=warmup_sent,
        dms_sent=dms_sent,
        emails_sent=emails_sent,
        replies_received=replies_received,
        calls_booked=calls_booked,
        closed_won=closed_won,
        pipeline_snapshot=pipeline_snapshot,
        qualify_rate=qualify_rate,
        reply_rate=reply_rate,
        email_reply_rate=email_reply_rate,
        close_rate=close_rate,
        top_platform=top_platform or "unknown",
        top_niche=top_niche or "unknown",
        prev_discovered=prev_discovered,
        prev_qualified=prev_qualified,
        prev_qualify_rate=prev_qualify_rate,
        prev_reply_rate=prev_reply_rate,
        dm_stats=dm_stats,
        email_stats=email_stats,
        variant_stats=variant_stats or [],
        warmup_analytics=warmup_analytics or {},
    ), None


def get_warmup_analytics(since_days: int = 30) -> tuple[Optional[dict], Optional[str]]:
    """
    Calculate correlation between warmup comment count and DM reply rate.

    Analyzes whether contacts who received more warmup comments have higher
    reply rates to subsequent DM outreach.

    Args:
        since_days: Look back this many days for warmup data

    Returns:
        (analytics_dict, None) on success with keys:
            - by_comment_count: dict mapping comment_count -> {sent, replies, reply_rate}
            - correlation: "positive", "negative", "neutral", or "insufficient_data"
            - sample_size: total contacts analyzed
        (None, error_message) on failure
    """
    since = datetime.now() - timedelta(days=since_days)
    since_iso = since.isoformat()

    # Get all contacts who went through warmup and then received DM outreach
    # (i.e., contacts in acq_warmup_schedules who later have outbound DMs in crm_messages)

    # Step 1: Get contacts with warmup activity
    warmup_contacts_query = f"""?status=eq.sent&sent_at=gte.{since_iso}&select=contact_id"""
    warmup_schedules, err = queries._select("acq_warmup_schedules", warmup_contacts_query)
    if err:
        return None, f"Error fetching warmup schedules: {err}"

    if not warmup_schedules:
        return {
            "by_comment_count": {},
            "correlation": "insufficient_data",
            "sample_size": 0,
            "recommendation": "No warmup data available for analysis"
        }, None

    # Get unique contact IDs
    warmup_contact_ids = set(s["contact_id"] for s in warmup_schedules)

    # Step 2: For each contact, count sent warmup comments and check if they replied
    by_comment_count = {
        0: {"sent": 0, "replies": 0, "reply_rate": 0.0},
        1: {"sent": 0, "replies": 0, "reply_rate": 0.0},
        2: {"sent": 0, "replies": 0, "reply_rate": 0.0},
        3: {"sent": 0, "replies": 0, "reply_rate": 0.0},
    }

    contacts_analyzed = 0

    for contact_id in warmup_contact_ids:
        # Count warmup comments sent to this contact
        contact_warmups, _ = queries._select(
            "acq_warmup_schedules",
            f"?contact_id=eq.{contact_id}&status=eq.sent&select=id"
        )
        comment_count = len(contact_warmups) if contact_warmups else 0

        # Normalize to 3+ if more than 3
        bucket = min(comment_count, 3)

        # Check if this contact received a DM
        outbound_dms, _ = queries._select(
            "crm_messages",
            f"?contact_id=eq.{contact_id}&message_type=eq.dm&is_outbound=eq.true&select=id,sent_at"
        )

        if not outbound_dms or len(outbound_dms) == 0:
            continue  # Skip contacts without DM outreach

        by_comment_count[bucket]["sent"] += 1
        contacts_analyzed += 1

        # Check if contact replied (has inbound message after outbound)
        # Simplified: just check for any inbound DM
        inbound_dms, _ = queries._select(
            "crm_messages",
            f"?contact_id=eq.{contact_id}&message_type=eq.dm&is_outbound=eq.false&select=id"
        )

        if inbound_dms and len(inbound_dms) > 0:
            by_comment_count[bucket]["replies"] += 1

    # Calculate reply rates for each bucket
    for count in by_comment_count:
        bucket = by_comment_count[count]
        bucket["reply_rate"] = safe_divide(bucket["replies"], bucket["sent"])

    # Determine correlation
    # Simple heuristic: compare 0-1 comments vs 2-3 comments
    low_warmup_reply_rate = safe_divide(
        by_comment_count[0]["replies"] + by_comment_count[1]["replies"],
        by_comment_count[0]["sent"] + by_comment_count[1]["sent"]
    )
    high_warmup_reply_rate = safe_divide(
        by_comment_count[2]["replies"] + by_comment_count[3]["replies"],
        by_comment_count[2]["sent"] + by_comment_count[3]["sent"]
    )

    if contacts_analyzed < 10:
        correlation = "insufficient_data"
        recommendation = f"Only {contacts_analyzed} contacts analyzed. Need at least 10 for reliable correlation."
    elif high_warmup_reply_rate > low_warmup_reply_rate * 1.2:  # 20% lift
        correlation = "positive"
        recommendation = f"Warmup comments correlate with higher reply rates ({high_warmup_reply_rate:.1%} vs {low_warmup_reply_rate:.1%}). Continue warmup strategy."
    elif high_warmup_reply_rate < low_warmup_reply_rate * 0.8:  # 20% drop
        correlation = "negative"
        recommendation = f"More warmup comments correlate with lower reply rates ({high_warmup_reply_rate:.1%} vs {low_warmup_reply_rate:.1%}). Consider reducing warmup."
    else:
        correlation = "neutral"
        recommendation = f"Warmup comment count shows minimal impact on reply rates ({high_warmup_reply_rate:.1%} vs {low_warmup_reply_rate:.1%})."

    return {
        "by_comment_count": by_comment_count,
        "correlation": correlation,
        "sample_size": contacts_analyzed,
        "low_warmup_reply_rate": low_warmup_reply_rate,
        "high_warmup_reply_rate": high_warmup_reply_rate,
        "recommendation": recommendation,
    }, None


def get_conversion_rates(since_days: int = 30) -> tuple[Optional[dict], Optional[str]]:
    """
    Calculate stage-to-stage conversion rates.

    Args:
        since_days: Look back this many days for conversion data

    Returns:
        (rates_dict, None) on success
        (None, error_message) on failure
    """
    from ..config import PIPELINE_STAGES

    since = datetime.now() - timedelta(days=since_days)

    totals = {}
    for stage in PIPELINE_STAGES:
        count, err = queries.count_contacts_that_reached_stage(stage, since)
        if err:
            return None, f"Error counting stage {stage}: {err}"
        totals[stage] = count

    return {
        "new_to_scored": safe_divide(totals.get('scored', 0), totals.get('new', 1)),
        "scored_to_qualified": safe_divide(totals.get('qualified', 0), totals.get('scored', 1)),
        "qualified_to_contacted": safe_divide(totals.get('contacted', 0), totals.get('qualified', 1)),
        "contacted_to_replied": safe_divide(totals.get('replied', 0), totals.get('contacted', 1)),
        "replied_to_closed": safe_divide(totals.get('closed_won', 0), totals.get('replied', 1)),
        "overall_funnel": safe_divide(totals.get('closed_won', 0), totals.get('new', 1)),
        "stage_counts": totals,
    }, None
