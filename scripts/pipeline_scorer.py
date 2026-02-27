#!/usr/bin/env python3
"""
pipeline_scorer.py — Stage 3: Scoring Agent
ICP fit score (0-100) + warmth score (0-100) → bucket + routing.

Run:
    python3 pipeline_scorer.py              # score all ENRICHED prospects
    python3 pipeline_scorer.py --rescore    # rescore every prospect
"""
import json, sys, os, argparse

sys.path.insert(0, os.path.dirname(__file__))
from pipeline_db import (get_prospects, update_prospect, get_offers,
                         advance_stage, utcnow, _select, _request)

# ── ICP criteria (customize per offer) ───────────────────────────────────

DEFAULT_ICP = {
    "target_niches":    ["ai", "automation", "saas", "creator", "solopreneur",
                         "marketing", "growth", "startup", "indie hacker"],
    "target_roles":     ["founder", "ceo", "creator", "marketer", "developer",
                         "freelancer", "consultant", "coach", "operator"],
    "pain_keywords":    ["can't grow", "stuck", "no clients", "need leads",
                         "struggling", "frustrat", "overwhelm", "manual",
                         "slow", "expensive", "time consuming", "waste"],
    "intent_keywords":  ["looking for", "need help with", "anyone recommend",
                         "what tool", "how do you", "trying to automate",
                         "hire", "budget", "invest", "build"],
    "budget_signals":   ["agency", "tool", "paid", "hire", "invest", "budget",
                         "client", "revenue", "mrr", "arr"],
    "avoid_signals":    ["student", "intern", "just learning", "hobby",
                         "no budget", "broke", "personal project only"],
}

PLATFORM_PREFERENCE_ORDER = ["twitter", "instagram", "tiktok", "linkedin"]


def score_icp(prospect, icp=None):
    """
    Return ICP fit score 0-100.
    Factors: niche match, role/title, pain signals, intent signals, budget signals.
    """
    icp = icp or DEFAULT_ICP
    score = 0.0

    niche = (prospect.get("niche") or "").lower()
    summary = (prospect.get("recent_posts_summary") or "").lower()
    pain_signals = prospect.get("pain_signals") or []
    intent_signals = prospect.get("intent_signals") or []
    tools_mentioned = prospect.get("tools_mentioned") or []
    all_text = f"{niche} {summary} {' '.join(pain_signals)} {' '.join(intent_signals)}".lower()

    # Niche match (30 pts)
    for n in icp["target_niches"]:
        if n in all_text:
            score += 30
            break
    else:
        # Partial credit for adjacent niches
        adjacent = ["business", "online", "digital", "content", "social"]
        for a in adjacent:
            if a in all_text:
                score += 12
                break

    # Role match (20 pts)
    display = (prospect.get("display_name") or "").lower()
    for role in icp["target_roles"]:
        if role in all_text or role in display:
            score += 20
            break

    # Pain signals (20 pts)
    pain_count = sum(1 for kw in icp["pain_keywords"] if kw in all_text)
    score += min(20, pain_count * 7)

    # Intent signals (15 pts)
    intent_count = sum(1 for kw in icp["intent_keywords"] if kw in all_text)
    score += min(15, intent_count * 5)

    # Budget signals (10 pts)
    budget_count = sum(1 for kw in icp["budget_signals"] if kw in all_text)
    score += min(10, budget_count * 3)

    # Audience size proxy for budget (5 pts)
    aud = int(prospect.get("audience_size") or 0)
    if aud > 10000:
        score += 5
    elif aud > 1000:
        score += 3

    # Avoid signals — subtract hard
    for sig in icp["avoid_signals"]:
        if sig in all_text:
            score -= 25
            break

    return max(0.0, min(100.0, score))


def score_warmth(prospect):
    """
    Return warmth score 0-100.
    Factors: follows you, engaged with your content, recency, mutuals,
             active in DMs, public contact available.
    """
    score = 0.0

    # Already in your CRM (was a previous contact)
    if prospect.get("contacted_at"):
        score += 20
    if prospect.get("responded_at"):
        score += 30

    # Has public contact info
    if prospect.get("public_email") or prospect.get("email"):
        score += 15
    if prospect.get("website"):
        score += 5

    # Discovery surface (engagers > followers > top_creator)
    surface = (prospect.get("discovery_surface") or "").lower()
    if surface == "commenter":
        score += 20   # actively engaging in niche
    elif surface == "engager":
        score += 15
    elif surface == "top_creator":
        score += 10   # public, active, but cold

    # Recency of activity (if we have it)
    touches = prospect.get("touches_sent") or 0
    if touches == 0:
        score += 0    # fresh — neutral
    elif touches == 1:
        score += 5    # had one contact

    # Pain signals (implies active and vocal)
    pain_signals = prospect.get("pain_signals") or []
    if len(pain_signals) >= 2:
        score += 10
    elif len(pain_signals) == 1:
        score += 5

    return max(0.0, min(100.0, score))


def assign_bucket(icp_score, warmth_score):
    """
    A1 = top priority: warm + high fit
    A2 = high fit, cold (worth effort)
    B1 = medium fit, warm (easier win, lower value)
    B2 = medium fit, cold (long-term nurture)
    C  = low fit (not worth outreach now)
    DNC = avoid
    """
    if icp_score < 0:
        return "DNC"
    if icp_score >= 60 and warmth_score >= 50:
        return "A1"
    if icp_score >= 60 and warmth_score < 50:
        return "A2"
    if icp_score >= 35 and warmth_score >= 50:
        return "B1"
    if icp_score >= 35 and warmth_score < 50:
        return "B2"
    return "C"


def pick_preferred_channel(prospect):
    """Choose the best outreach channel based on available handles."""
    for platform in PLATFORM_PREFERENCE_ORDER:
        handle = prospect.get(f"{platform}_handle")
        if handle:
            return f"dm_{platform}"
    if prospect.get("public_email") or prospect.get("email"):
        return "email"
    return "none"


def match_offer(prospect, offers):
    """Return the offer UUID that best matches this prospect's niche/signals."""
    if not offers:
        return None
    niche = (prospect.get("niche") or "").lower()
    summary = (prospect.get("recent_posts_summary") or "").lower()
    all_text = f"{niche} {summary}"

    best_offer = None
    best_score = -1
    for offer in offers:
        score = 0
        for n in (offer.get("icp_niche") or []):
            if n.lower() in all_text:
                score += 3
        for sig in (offer.get("icp_signals") or []):
            if sig.lower() in all_text:
                score += 2
        if score > best_score:
            best_score = score
            best_offer = offer

    return best_offer.get("id") if best_offer else None


def score_prospect(prospect, offers=None):
    """Return updated fields dict for one prospect."""
    icp = score_icp(prospect)
    warmth = score_warmth(prospect)
    bucket = assign_bucket(icp, warmth)
    channel = pick_preferred_channel(prospect)
    offer_id = match_offer(prospect, offers or [])

    return {
        "icp_score":         round(icp, 1),
        "warmth_score":      round(warmth, 1),
        "bucket":            bucket,
        "preferred_channel": channel,
        "offer_match":       offer_id,
        "stage":             "DNC" if bucket == "DNC" else "SCORED",
        "do_not_contact":    bucket == "DNC",
    }


def run_scorer(rescore=False, dry_run=False):
    """Score all ENRICHED (or all if rescore) prospects."""
    print(f"\n📊 Running Scorer (rescore={rescore}, dry_run={dry_run})")

    stages = None if rescore else "ENRICHED"
    prospects, err = get_prospects(stage=stages, limit=500)
    if err:
        print(f"  ❌ Error fetching prospects: {err}")
        return 0

    offers = get_offers()
    print(f"  🎯 {len(prospects)} prospects to score | {len(offers)} offers loaded")

    scored = 0
    bucket_counts = {}
    for p in prospects:
        fields = score_prospect(p, offers)
        bucket = fields["bucket"]
        bucket_counts[bucket] = bucket_counts.get(bucket, 0) + 1

        if not dry_run:
            _, err = update_prospect(p["id"], fields)
            if not err:
                scored += 1
        else:
            scored += 1

    print(f"\n  ✅ Scored {scored} prospects")
    print("  Bucket distribution:")
    for bucket in ["A1", "A2", "B1", "B2", "C", "DNC"]:
        n = bucket_counts.get(bucket, 0)
        bar = "█" * min(n, 40)
        print(f"    {bucket}: {n:4d} {bar}")

    return scored


def main():
    parser = argparse.ArgumentParser(description="Pipeline Scorer")
    parser.add_argument("--rescore", action="store_true",
                        help="Rescore all prospects, not just ENRICHED ones")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run_scorer(rescore=args.rescore, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
