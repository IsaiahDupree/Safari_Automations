#!/usr/bin/env python3
"""
pipeline_outreach.py — Stage 5+6: Warm-up + Outreach Agent
Drafts personalized first-touch messages, queues them for approval,
sends approved DMs via existing platform services, classifies replies.

Run:
    python3 pipeline_outreach.py --action queue   # draft messages for A1/A2 bucket
    python3 pipeline_outreach.py --action approve # list queued touches (human approval)
    python3 pipeline_outreach.py --action send    # send approved touches
    python3 pipeline_outreach.py --action replies # check for and classify replies
"""
import json, sys, os, re, time, argparse, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(__file__))
from pipeline_db import (
    get_prospects, update_prospect, queue_touch, get_queued_touches,
    get_approved_touches, mark_touch_sent, record_reply, advance_stage,
    get_offers, utcnow, _select, _request
)

DM_SERVICES = {
    "instagram": "http://localhost:3001",
    "twitter":   "http://localhost:3003",
    "tiktok":    "http://localhost:3102",
    "linkedin":  "http://localhost:3105",
}

MAX_DAILY_OUTREACH = int(os.environ.get("MAX_DAILY_OUTREACH", "30"))

# ── Message templates ──────────────────────────────────────────────────────

OPENERS = {
    "generic": (
        "Hey {name}, came across your work on {niche} — love what you're building. "
        "Had a quick question: are you handling {pain_topic} manually or have you "
        "found something that works? Building something in this space and wanted to "
        "hear from people actually in it."
    ),
    "creator": (
        "Hey {name}, your post about {recent_topic} was exactly what I needed to see. "
        "Question — are you finding it hard to {pain_topic}? We've been helping "
        "{niche} builders solve this. Would love to show you what we've built if it's relevant."
    ),
    "founder": (
        "Hey {name}, fellow builder here. Noticed you're working in {niche} — "
        "are you running into {pain_topic}? I built something specifically for this "
        "after hitting the same wall. Happy to share if it'd be useful, no pitch."
    ),
    "pain_direct": (
        "Hey {name}, saw your post about {pain_topic} — that's exactly the problem "
        "we solve. Would it be useful if I sent you a quick breakdown of how we "
        "handle this? Takes 2 min to read, no strings."
    ),
}

INTENT_LABELS = {
    "interested":  "prospect is interested, wants to learn more",
    "curious":     "asks a question or wants more info",
    "objection":   "raises a concern or objection",
    "not_now":     "not ready right now, potential future",
    "referral":    "suggests someone else who might be interested",
    "dnc":         "says stop, not interested, remove me",
    "no_reply":    "no response after expected wait window",
}

# ── Message drafting ───────────────────────────────────────────────────────

def draft_message(prospect, offer=None):
    """
    Generate a personalized opener for this prospect.
    Uses template filling — no LLM required for V1.
    """
    name = (prospect.get("display_name") or "there").split()[0].title()
    niche = prospect.get("niche") or "your space"
    pain_signals = prospect.get("pain_signals") or []
    intent_signals = prospect.get("intent_signals") or []
    summary = prospect.get("recent_posts_summary") or ""

    # Choose pain topic
    if pain_signals:
        pain_topic = pain_signals[0]
    elif niche:
        pain_topic = f"growing in {niche}"
    else:
        pain_topic = "scaling manually"

    # Choose recent topic from summary
    recent_topic = "your recent post"
    if summary:
        words = summary.split()[:8]
        recent_topic = " ".join(words[:5]).rstrip(".,|")

    # Choose template
    if pain_signals:
        template_key = "pain_direct"
    elif "founder" in (prospect.get("role") or "").lower():
        template_key = "founder"
    elif prospect.get("audience_size", 0) > 5000:
        template_key = "creator"
    else:
        template_key = "generic"

    template = OPENERS[template_key]
    msg = template.format(
        name=name,
        niche=niche,
        pain_topic=pain_topic,
        recent_topic=recent_topic,
    )

    # Append offer hint if available
    if offer and offer.get("pitch_url"):
        msg += f"\n\n{offer['pitch_url']}"

    return msg.strip()


def pick_platform_for_touch(prospect):
    """Return the best (platform, handle) pair for outreach."""
    order = ["twitter", "instagram", "tiktok", "linkedin"]
    for plat in order:
        handle = prospect.get(f"{plat}_handle")
        if handle:
            return plat, handle
    return None, None


# ── Warm-up actions ────────────────────────────────────────────────────────

def queue_warmup(prospect, require_approval=True):
    """Queue a low-friction warm-up action (like/comment) before DMing."""
    plat, handle = pick_platform_for_touch(prospect)
    if not plat:
        return False

    # Warm-up = a contextual comment or like — just log the intent for now
    warmup_note = f"[Warm-up] Like/comment on @{handle}'s recent {plat} post about {prospect.get('niche','their niche')}"
    queue_touch(
        prospect_id=prospect["id"],
        touch_type="warmup_note",
        platform=plat,
        content=warmup_note,
        require_approval=require_approval,
    )
    update_prospect(prospect["id"], {
        "stage": "WARMING",
        "next_touch_at": utcnow(),  # schedule actual DM after warmup confirmed
    })
    return True


# ── Outreach queue builder ─────────────────────────────────────────────────

def queue_outreach_for_bucket(buckets=("A1", "A2"), limit=30,
                               require_approval=True, dry_run=False):
    """
    Find SCORED prospects in target buckets, draft a message for each,
    and queue a touch record.
    """
    offers = get_offers()
    offer_map = {o["id"]: o for o in offers}
    queued = 0

    for bucket in buckets:
        prospects, _ = get_prospects(bucket=bucket, limit=limit)
        prospects = [p for p in prospects
                     if p.get("stage") in ("SCORED", "WARMED")
                     and not p.get("do_not_contact")
                     and int(p.get("touches_sent") or 0) < int(p.get("max_touches") or 3)]

        print(f"  📤 Bucket {bucket}: {len(prospects)} prospects to queue")

        for p in prospects[:limit - queued]:
            plat, handle = pick_platform_for_touch(p)
            if not plat:
                continue

            offer = offer_map.get(p.get("offer_match", ""))
            msg = draft_message(p, offer)

            if dry_run:
                print(f"    [DRY] @{handle} ({plat}): {msg[:80]}...")
                queued += 1
                continue

            _, err = queue_touch(
                prospect_id=p["id"],
                touch_type="dm",
                platform=plat,
                content=msg,
                channel=f"dm_{plat}",
                require_approval=require_approval,
            )
            if not err:
                update_prospect(p["id"], {
                    "stage": "OUTREACH_QUEUED",
                    "next_touch_at": utcnow(),
                })
                queued += 1

    print(f"  ✅ {queued} touches queued (approval_required={require_approval})")
    return queued


# ── Sending approved touches ───────────────────────────────────────────────

def http_post(url, body, timeout=30):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read()), None
    except Exception as e:
        return None, str(e)[:80]


def send_dm_via_service(platform, handle, message):
    """Send a DM using the platform's existing service."""
    svc = DM_SERVICES.get(platform)
    if not svc:
        return False, f"No service for {platform}"

    endpoint_map = {
        "instagram": "/api/messages/send-to",
        "twitter":   "/api/messages/send-to",
        "tiktok":    "/api/messages/send-to",
        "linkedin":  "/api/messages/send-to",
    }
    endpoint = endpoint_map.get(platform, "/api/messages/send-to")
    payload = {"username": handle, "message": message}
    data, err = http_post(f"{svc}{endpoint}", payload)
    if err:
        return False, err
    success = data.get("success", False) if data else False
    return success, None


def send_approved_touches(dry_run=False):
    """Send all approved (human-approved) touches."""
    touches, _ = get_approved_touches(limit=MAX_DAILY_OUTREACH)
    print(f"\n📨 Sending {len(touches)} approved touches (dry_run={dry_run})")

    sent = 0
    failed = 0
    for touch in touches:
        plat = touch.get("platform")
        content = touch.get("content", "")
        prospect_id = touch.get("prospect_id")
        touch_id = touch.get("id")

        # Get prospect handle
        prospects, _ = _select("prospects", f"?id=eq.{prospect_id}&limit=1")
        prospect = prospects[0] if prospects else {}
        handle = (prospect.get(f"{plat}_handle") or "").lstrip("@")
        if not handle:
            print(f"  ⚠️  No handle for prospect {prospect_id} on {plat}")
            continue

        print(f"  → @{handle} ({plat}): {content[:60]}...")

        if dry_run:
            sent += 1
            continue

        success, err = send_dm_via_service(plat, handle, content)
        if success:
            mark_touch_sent(touch_id, sent=True)
            update_prospect(prospect_id, {
                "stage": "CONTACTED",
                "contacted_at": utcnow(),
                "last_touch_at": utcnow(),
                "touches_sent": int(prospect.get("touches_sent") or 0) + 1,
            })
            sent += 1
            print(f"    ✅ Sent")
        else:
            mark_touch_sent(touch_id, sent=False)
            failed += 1
            print(f"    ❌ Failed: {err}")

        time.sleep(2)  # rate limit spacing

    print(f"\n  ✅ {sent} sent | ❌ {failed} failed")
    return sent


# ── Reply classification ───────────────────────────────────────────────────

REPLY_PATTERNS = {
    "dnc":        ["stop", "remove", "unsubscribe", "not interested", "go away",
                   "don't contact", "leave me alone", "block"],
    "interested": ["yes", "tell me more", "interested", "how does", "sounds good",
                   "love to", "would love", "let's talk", "schedule", "call"],
    "curious":    ["what is", "how does it", "can you", "more info", "details",
                   "what do you", "how much", "pricing", "cost", "what exactly"],
    "objection":  ["but", "however", "not sure", "concern", "worry", "doubt",
                   "already have", "using", "don't need", "won't work"],
    "not_now":    ["later", "not now", "busy", "maybe", "sometime", "in the future",
                   "few months", "next quarter", "right now isn't"],
    "referral":   ["you should talk to", "check out", "my friend", "colleague",
                   "they need", "connect you", "introduce"],
}

def classify_reply(text):
    """Simple keyword-based intent classification."""
    text_lower = text.lower()
    for intent, patterns in REPLY_PATTERNS.items():
        for p in patterns:
            if p in text_lower:
                return intent
    return "curious"  # default: assume curious if can't classify


def next_step_message(intent, prospect_name="there", offer=None):
    """Draft a next-step reply based on classified intent."""
    name = (prospect_name or "there").split()[0].title()
    templates = {
        "interested": f"Awesome, {name}! Happy to show you exactly how it works — "
                      f"easiest is a quick 15-min call or I can send a loom. What works better?",
        "curious":    f"Good question! {name}, here's the quick version: [INSERT BRIEF EXPLANATION]. "
                      f"Does that make sense for your situation?",
        "objection":  f"Totally fair, {name}. Most people felt that way at first — "
                      f"the thing that changed their mind was [INSERT KEY INSIGHT]. Does that address it?",
        "not_now":    f"No worries, {name}! I'll follow up in a few weeks. "
                      f"Mind if I send you one useful resource in the meantime?",
        "referral":   f"Thanks {name}! Who should I reach out to? Happy to mention you sent me.",
    }
    return templates.get(intent, f"Thanks {name}, noted!")


# ── Main entry ─────────────────────────────────────────────────────────────

def show_queue():
    """Print all queued touches for human review + approval."""
    touches, _ = get_queued_touches(limit=100)
    if not touches:
        print("No touches in queue.")
        return

    print(f"\n{'='*60}")
    print(f"OUTREACH QUEUE — {len(touches)} touches pending approval")
    print(f"{'='*60}")
    for i, t in enumerate(touches, 1):
        prospects, _ = _select("prospects", f"?id=eq.{t['prospect_id']}&limit=1")
        p = prospects[0] if prospects else {}
        plat = t.get("platform", "?")
        handle = p.get(f"{plat}_handle", "unknown")
        print(f"\n[{i}] @{handle} ({plat}) — ICP:{p.get('icp_score',0):.0f} "
              f"Warm:{p.get('warmth_score',0):.0f} Bucket:{p.get('bucket','?')}")
        print(f"  MSG: {t['content'][:150]}")
        print(f"  Touch ID: {t['id']}")
    print(f"\n{'='*60}")
    print("To approve a touch: UPDATE prospect_touches SET status='approved' WHERE id='...'")
    print("Or use: python3 pipeline_outreach.py --action approve-all  (approves all A1)")


def approve_all_a1(dry_run=False):
    """Auto-approve all A1 bucket touches (highest confidence)."""
    touches, _ = get_queued_touches(limit=200)
    approved = 0
    for t in touches:
        prospects, _ = _select("prospects", f"?id=eq.{t['prospect_id']}&limit=1")
        p = prospects[0] if prospects else {}
        if p.get("bucket") == "A1":
            if not dry_run:
                _request("PATCH", "prospect_touches",
                         body={"status": "approved"},
                         params=f"?id=eq.{t['id']}")
            approved += 1
    print(f"  ✅ Auto-approved {approved} A1 touches")
    return approved


def main():
    parser = argparse.ArgumentParser(description="Pipeline Outreach Agent")
    parser.add_argument("--action",
                        choices=["queue", "approve", "approve-all", "send", "replies"],
                        default="queue")
    parser.add_argument("--buckets", default="A1,A2",
                        help="Comma-separated buckets to queue (default: A1,A2)")
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--require-approval", action="store_true", default=True)
    args = parser.parse_args()

    if args.action == "queue":
        buckets = [b.strip() for b in args.buckets.split(",")]
        queue_outreach_for_bucket(
            buckets=buckets, limit=args.limit,
            require_approval=args.require_approval, dry_run=args.dry_run
        )
    elif args.action == "approve":
        show_queue()
    elif args.action == "approve-all":
        approve_all_a1(dry_run=args.dry_run)
    elif args.action == "send":
        send_approved_touches(dry_run=args.dry_run)
    elif args.action == "replies":
        print("Reply classification: coming in V2 (requires inbox polling)")


if __name__ == "__main__":
    main()
