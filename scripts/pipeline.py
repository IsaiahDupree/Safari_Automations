#!/usr/bin/env python3
"""
pipeline.py — Main Autonomous Client Acquisition Orchestrator

Runs the full pipeline:
  1. Scout  → keyword search → top creators + engagers
  2. Enrich → public profile data + signal extraction
  3. Score  → ICP fit + warmth → A1/A2/B1/B2/C/DNC buckets
  4. Plan   → pick channel, draft opener, queue touches
  5. Send   → send approved touches (human gate by default)
  6. Optimize (weekly) → attribution + pattern analysis

Usage:
    # Seed keywords + offers first (run once)
    python3 pipeline.py --setup

    # Full daily run
    python3 pipeline.py

    # Dry run (see what would happen, no DB writes)
    python3 pipeline.py --dry-run

    # Individual stages
    python3 pipeline.py --stage scout
    python3 pipeline.py --stage enrich
    python3 pipeline.py --stage score
    python3 pipeline.py --stage outreach

    # Show pipeline status
    python3 pipeline.py --status

    # Show outreach queue (for human approval)
    python3 pipeline.py --queue
"""
import json, sys, os, time, argparse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from pipeline_db import (
    seed_keywords, seed_offers, get_active_keywords, get_prospects,
    get_queued_touches, get_approved_touches, get_offers,
    utcnow, _select, log_run
)
from pipeline_scout import run_scout
from pipeline_enricher import run_enricher
from pipeline_scorer import run_scorer
from pipeline_outreach import (
    queue_outreach_for_bucket, send_approved_touches,
    approve_all_a1, show_queue
)

# ── Seed data — customize these for your offer/niche ───────────────────────

DEFAULT_KEYWORDS = [
    # Core / identity
    {"keyword": "ai automation",      "category": "core",       "niche": "automation"},
    {"keyword": "solopreneur",         "category": "identity",   "niche": "creator"},
    {"keyword": "indie hacker",        "category": "identity",   "niche": "startup"},
    {"keyword": "building in public",  "category": "identity",   "niche": "startup"},
    {"keyword": "creator economy",     "category": "core",       "niche": "creator"},
    # Pain
    {"keyword": "can't get clients",   "category": "pain",       "niche": "freelance"},
    {"keyword": "no leads",            "category": "pain",       "niche": "freelance"},
    {"keyword": "struggling to grow",  "category": "pain",       "niche": "creator"},
    {"keyword": "outreach that works", "category": "intent",     "niche": "sales"},
    # Intent
    {"keyword": "looking for automation", "category": "intent",  "niche": "automation"},
    {"keyword": "need help with outreach","category": "intent",  "niche": "sales"},
    {"keyword": "how to get clients",  "category": "intent",     "niche": "freelance"},
    # Competitor / tool
    {"keyword": "clay io outreach",    "category": "competitor", "niche": "sales"},
    {"keyword": "apollo io alternative","category": "competitor","niche": "sales"},
    {"keyword": "instantly ai",        "category": "competitor", "niche": "sales"},
]

DEFAULT_OFFERS = [
    {
        "name":        "AI Outreach Automation",
        "description": "Done-for-you autonomous DM + email outreach system that finds leads, "
                       "warms them up, and sends personalized messages on autopilot.",
        "price_range": "$500-$2000/month",
        "icp_niche":   ["automation", "startup", "freelance", "sales", "creator"],
        "icp_roles":   ["founder", "ceo", "marketer", "consultant", "freelancer"],
        "icp_signals": ["struggling to grow", "no leads", "manual outreach", "need clients"],
        "pitch_url":   "https://safariauto.io",  # replace with real URL
        "active":      True,
    },
    {
        "name":        "Safari Automation Suite",
        "description": "Full social media automation — research, DM, comment, post across "
                       "Instagram, Twitter, TikTok, LinkedIn from one dashboard.",
        "price_range": "$200-$1000/month",
        "icp_niche":   ["creator", "automation", "marketing", "growth"],
        "icp_roles":   ["creator", "marketer", "growth hacker", "social media manager"],
        "icp_signals": ["social media growth", "content automation", "dm automation"],
        "pitch_url":   "https://safariauto.io",  # replace with real URL
        "active":      True,
    },
]

# ── Pipeline status report ─────────────────────────────────────────────────

def print_status():
    """Print a full pipeline health snapshot."""
    print(f"\n{'='*65}")
    print(f"  PIPELINE STATUS — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*65}")

    stages = [
        "NEW","DISCOVERED","ENRICHED","SCORED","PLANNED",
        "WARMING","WARMED","OUTREACH_QUEUED","CONTACTED",
        "RESPONDED","QUALIFIED","PITCH_READY","PITCHED",
        "NURTURE","WON","LOST","DNC",
    ]
    total = 0
    for stage in stages:
        rows, _ = get_prospects(stage=stage, limit=1000)
        n = len(rows) if rows else 0
        if n > 0:
            bar = "█" * min(n, 35)
            print(f"  {stage:<18} {n:5d} {bar}")
            total += n

    print(f"  {'─'*50}")
    print(f"  {'TOTAL':<18} {total:5d}")

    # Bucket breakdown
    print(f"\n  Bucket breakdown (SCORED+):")
    buckets = ["A1","A2","B1","B2","C","DNC"]
    for bucket in buckets:
        rows, _ = _select("prospects", f"?bucket=eq.{bucket}&limit=1000")
        n = len(rows) if rows else 0
        bar = "█" * min(n, 20)
        print(f"  {bucket:<8} {n:5d} {bar}")

    # Touch queue
    queued, _ = get_queued_touches(limit=1000)
    approved, _ = get_approved_touches(limit=1000)
    print(f"\n  Touches queued (awaiting approval): {len(queued)}")
    print(f"  Touches approved (ready to send):   {len(approved)}")

    # Recent pipeline runs
    runs, _ = _select("pipeline_runs",
                      "?order=started_at.desc&limit=5")
    if runs:
        print(f"\n  Recent runs:")
        for r in runs:
            ts = (r.get("started_at") or "")[:16]
            print(f"  [{ts}] {r.get('phase','-'):<10} "
                  f"platform={str(r.get('platform') or 'all'):<12} "
                  f"found={r.get('prospects_found',0)}")

    print(f"{'='*65}")


# ── Full pipeline run ──────────────────────────────────────────────────────

def run_full_pipeline(dry_run=False, auto_send=False,
                      scout_platforms=None, max_per_platform=3):
    """
    Run all pipeline stages in order.
    By default, touches require human approval before sending.
    Pass --auto-send to approve and send A1 bucket automatically.
    """
    print(f"\n{'='*65}")
    print(f"  PIPELINE RUN — {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"  dry_run={dry_run}  auto_send={auto_send}")
    print(f"{'='*65}")

    keywords = get_active_keywords()
    if not keywords:
        print("\n⚠️  No active keywords found. Run: python3 pipeline.py --setup")
        return

    platforms = scout_platforms or ["twitter", "instagram", "tiktok"]
    total_found = 0

    # ── Stage 1: Scout ───────────────────────────────────────────────────
    print(f"\n{'─'*40}")
    print("  STAGE 1: Scout")
    print(f"{'─'*40}")
    for kw in keywords[:max_per_platform]:
        for plat in platforms:
            n = run_scout(plat, kw["keyword"], dry_run=dry_run)
            total_found += n
            time.sleep(1)

    print(f"\n  📊 Scout total: {total_found} prospects discovered")

    # ── Stage 2: Enrich ──────────────────────────────────────────────────
    print(f"\n{'─'*40}")
    print("  STAGE 2: Enrich")
    print(f"{'─'*40}")
    enriched = run_enricher(limit=200, dry_run=dry_run)
    print(f"  📊 Enrich total: {enriched} prospects enriched")

    # ── Stage 3: Score ───────────────────────────────────────────────────
    print(f"\n{'─'*40}")
    print("  STAGE 3: Score")
    print(f"{'─'*40}")
    scored = run_scorer(dry_run=dry_run)
    print(f"  📊 Score total: {scored} prospects scored")

    # ── Stage 4: Queue outreach ──────────────────────────────────────────
    print(f"\n{'─'*40}")
    print("  STAGE 4: Queue Outreach")
    print(f"{'─'*40}")
    queued = queue_outreach_for_bucket(
        buckets=["A1", "A2"],
        limit=50,
        require_approval=not auto_send,
        dry_run=dry_run,
    )

    # ── Stage 5: Auto-approve A1 if requested ───────────────────────────
    if auto_send and not dry_run:
        print(f"\n{'─'*40}")
        print("  STAGE 5: Auto-approve + Send A1")
        print(f"{'─'*40}")
        approve_all_a1(dry_run=False)
        sent = send_approved_touches(dry_run=False)
        print(f"  📊 Sent: {sent}")
    else:
        queued_count, _ = get_queued_touches(limit=1000)
        print(f"\n  ⏳ {len(queued_count)} touches in queue — "
              "run `python3 pipeline.py --queue` to review + approve")
        print("     Then: `python3 pipeline_outreach.py --action send` to send")

    # ── Summary ──────────────────────────────────────────────────────────
    print(f"\n{'='*65}")
    print("  RUN COMPLETE")
    print(f"  Discovered: {total_found}  Enriched: {enriched}  Scored: {scored}  Queued: {queued}")
    print(f"{'='*65}")
    print_status()


# ── Setup ──────────────────────────────────────────────────────────────────

def run_setup():
    """Seed default keywords and offers into Supabase."""
    print("\n🔧 Setting up pipeline...")
    n, err = seed_keywords(DEFAULT_KEYWORDS)
    if err:
        print(f"  ⚠️  Keywords seed warning: {err}")
    else:
        print(f"  ✅ {len(DEFAULT_KEYWORDS)} keywords seeded")

    n, err = seed_offers(DEFAULT_OFFERS)
    if err:
        print(f"  ⚠️  Offers seed warning: {err}")
    else:
        print(f"  ✅ {len(DEFAULT_OFFERS)} offers seeded")

    print("\n  You can now run: python3 pipeline.py --dry-run")
    print("  Or customize keywords in Supabase: pipeline_keywords table")
    print("  And offers in: pipeline_offers table")


# ── Entry ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Autonomous Client Acquisition Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 pipeline.py --setup           # seed keywords + offers (run once)
  python3 pipeline.py --dry-run         # preview full run
  python3 pipeline.py                   # full daily run (human approves sends)
  python3 pipeline.py --auto-send       # A1 bucket sends automatically
  python3 pipeline.py --status          # show pipeline health
  python3 pipeline.py --queue           # show outreach queue for review
  python3 pipeline.py --stage scout --keyword "ai automation" --platform twitter
        """,
    )
    parser.add_argument("--setup",       action="store_true", help="Seed keywords + offers")
    parser.add_argument("--status",      action="store_true", help="Print pipeline status")
    parser.add_argument("--queue",       action="store_true", help="Show outreach queue")
    parser.add_argument("--dry-run",     action="store_true")
    parser.add_argument("--auto-send",   action="store_true",
                        help="Auto-approve + send A1 bucket touches")
    parser.add_argument("--stage",       choices=["scout","enrich","score","outreach","send"],
                        help="Run a single stage only")
    parser.add_argument("--keyword",     help="Keyword for scout stage")
    parser.add_argument("--platform",    default="twitter",
                        choices=["twitter","instagram","tiktok","threads"])
    parser.add_argument("--platforms",   default="twitter,instagram,tiktok",
                        help="Comma-separated platforms for full run")
    parser.add_argument("--limit",       type=int, default=3,
                        help="Max keywords per platform per run")
    args = parser.parse_args()

    if args.setup:
        run_setup()
    elif args.status:
        print_status()
    elif args.queue:
        show_queue()
    elif args.stage == "scout":
        kw = args.keyword or "ai automation"
        run_scout(args.platform, kw, dry_run=args.dry_run)
    elif args.stage == "enrich":
        run_enricher(dry_run=args.dry_run)
    elif args.stage == "score":
        run_scorer(dry_run=args.dry_run)
    elif args.stage == "outreach":
        queue_outreach_for_bucket(dry_run=args.dry_run)
    elif args.stage == "send":
        send_approved_touches(dry_run=args.dry_run)
    else:
        # Full run
        platforms = [p.strip() for p in args.platforms.split(",")]
        run_full_pipeline(
            dry_run=args.dry_run,
            auto_send=args.auto_send,
            scout_platforms=platforms,
            max_per_platform=args.limit,
        )


if __name__ == "__main__":
    main()
